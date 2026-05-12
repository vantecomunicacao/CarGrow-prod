import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { DEFAULT_AGENT_PROMPT } from '@/lib/defaults/agentPrompt'

async function verifyMaster() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const adminClient = createAdminClient()
  const { data: { user: adminUser } } = await adminClient.auth.admin.getUserById(user.id)
  if (!adminUser || adminUser.user_metadata?.is_master !== true) return null

  return { adminClient, callerId: user.id }
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function POST(request: NextRequest) {
  const auth = await verifyMaster()
  if (!auth) {
    return Response.json({ error: 'Acesso não autorizado.' }, { status: 403 })
  }

  const body = await request.json() as {
    // Dados da loja
    store_name: string
    plan: string
    city?: string
    state?: string
    phone?: string
    email?: string
    // Dados do ADM
    owner_name: string
    owner_email: string
    owner_password: string
  }

  if (!body.store_name || !body.owner_email || !body.owner_password || !body.owner_name) {
    return Response.json({ error: 'Nome da loja, nome, e-mail e senha do ADM são obrigatórios.' }, { status: 400 })
  }

  if (body.owner_password.length < 8) {
    return Response.json({ error: 'A senha deve ter pelo menos 8 caracteres.' }, { status: 400 })
  }

  const { adminClient } = auth

  // Generate unique slug
  let slug = generateSlug(body.store_name)
  const { data: existing } = await adminClient
    .from('stores')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (existing) {
    slug = `${slug}-${Date.now()}`
  }

  // 1. Create the store
  const { data: store, error: storeError } = await adminClient
    .from('stores')
    .insert({
      name: body.store_name,
      slug,
      plan: body.plan ?? 'trial',
      city: body.city ?? null,
      state: body.state ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      is_active: true,
      agent_prompt: DEFAULT_AGENT_PROMPT,
    })
    .select('id, name, slug, plan, is_active, created_at, city, state, phone')
    .single()

  if (storeError || !store) {
    return Response.json({ error: storeError?.message ?? 'Erro ao criar loja.' }, { status: 500 })
  }

  // 2. Create the owner user
  const { data: ownerData, error: userError } = await adminClient.auth.admin.createUser({
    email: body.owner_email,
    password: body.owner_password,
    email_confirm: true,
    user_metadata: {
      full_name: body.owner_name,
    },
  })

  if (userError || !ownerData.user) {
    // Rollback: delete the store
    await adminClient.from('stores').delete().eq('id', store.id)
    return Response.json({ error: userError?.message ?? 'Erro ao criar usuário ADM.' }, { status: 500 })
  }

  // 3. Link owner to store
  const { error: linkError } = await adminClient
    .from('store_users')
    .insert({
      store_id: store.id,
      user_id: ownerData.user.id,
      role: 'owner',
      is_active: true,
    })

  if (linkError) {
    // Rollback both
    await adminClient.auth.admin.deleteUser(ownerData.user.id)
    await adminClient.from('stores').delete().eq('id', store.id)
    return Response.json({ error: 'Erro ao vincular ADM à loja.' }, { status: 500 })
  }

  return Response.json({
    store: { ...store, vehicleCount: 0, leadCount: 0 },
  }, { status: 201 })
}
