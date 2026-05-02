import { createClient, createAdminClient } from '@/lib/supabase/server'
import { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'

async function verifyMaster() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const adminClient = createAdminClient()
  const { data: { user: adminUser } } = await adminClient.auth.admin.getUserById(user.id)
  if (!adminUser || adminUser.user_metadata?.is_master !== true) return null

  return { adminClient, callerId: user.id }
}

// Lista recursivamente todos os arquivos sob `prefix` num bucket e retorna seus paths completos.
async function listAllFiles(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = []
  const stack: string[] = [prefix]
  while (stack.length > 0) {
    const folder = stack.pop()!
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 })
    if (error || !data) continue
    for (const entry of data) {
      const fullPath = `${folder}/${entry.name}`
      // entry.id é null para "pastas" (prefixos). Arquivos têm id.
      if (entry.id) out.push(fullPath)
      else stack.push(fullPath)
    }
  }
  return out
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await verifyMaster()
  if (!auth) {
    return Response.json({ error: 'Acesso não autorizado.' }, { status: 403 })
  }
  const { adminClient } = auth

  const body = await request.json() as { plan?: string; is_active?: boolean }

  const update: Record<string, unknown> = {}
  if (body.plan !== undefined) update.plan = body.plan
  if (body.is_active !== undefined) update.is_active = body.is_active

  if (Object.keys(update).length === 0) {
    return Response.json({ error: 'Nenhum campo para atualizar.' }, { status: 400 })
  }

  const { error } = await adminClient
    .from('stores')
    .update(update)
    .eq('id', id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}

// Apaga uma loja por completo: arquivos no Storage, registros do banco (cascade)
// e usuários do auth que estavam vinculados exclusivamente a essa loja.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await verifyMaster()
  if (!auth) {
    return Response.json({ error: 'Acesso não autorizado.' }, { status: 403 })
  }
  const { adminClient } = auth

  // Confirma que a loja existe antes de qualquer operação destrutiva
  const { data: store } = await adminClient
    .from('stores')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (!store) {
    return Response.json({ error: 'Loja não encontrada.' }, { status: 404 })
  }

  // 1. Coleta os usuários vinculados à loja (para decidir o que apagar do auth depois)
  const { data: links } = await adminClient
    .from('store_users')
    .select('user_id')
    .eq('store_id', id)

  const userIds = (links ?? []).map((l) => l.user_id)

  // 2. Remove arquivos do Storage (logo/banner/favicon e fotos de veículos)
  for (const bucket of ['store-assets', 'vehicle-images']) {
    const files = await listAllFiles(adminClient, bucket, id)
    if (files.length > 0) {
      await adminClient.storage.from(bucket).remove(files)
    }
  }

  // 3. Apaga a loja — CASCADE limpa store_users, vehicles, vehicle_images,
  //    leads, agent_conversations, agent_logs, knowledge_base.
  const { error: deleteError } = await adminClient
    .from('stores')
    .delete()
    .eq('id', id)

  if (deleteError) {
    return Response.json({ error: deleteError.message }, { status: 500 })
  }

  // 4. Para cada usuário vinculado: se não é master e não está em nenhuma outra loja,
  //    apaga do auth. (Masters e usuários multi-loja são preservados.)
  for (const userId of userIds) {
    if (userId === auth.callerId) continue

    const { data: { user: authUser } } = await adminClient.auth.admin.getUserById(userId)
    if (!authUser) continue
    if (authUser.user_metadata?.is_master === true) continue

    const { count } = await adminClient
      .from('store_users')
      .select('store_id', { count: 'exact', head: true })
      .eq('user_id', userId)

    if ((count ?? 0) === 0) {
      await adminClient.auth.admin.deleteUser(userId)
    }
  }

  return Response.json({ success: true })
}
