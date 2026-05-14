import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// DELETE /api/team/[id] — soft-delete: desativa membro (não remove owner)
//
// Autorização (defense in depth — o middleware ignora /api/*, então
// a checagem precisa estar aqui):
// 1. Caller deve estar autenticado.
// 2. Caller deve ser owner de UMA loja.
// 3. O membro alvo deve pertencer à mesma loja do caller.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })

  const admin = createAdminClient()

  // Loja do caller + verificação de role owner
  const { data: caller } = await admin
    .from('store_users')
    .select('store_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!caller) {
    return NextResponse.json({ error: 'Loja não encontrada.' }, { status: 404 })
  }
  if (caller.role !== 'owner') {
    return NextResponse.json({ error: 'Apenas o owner pode remover membros.' }, { status: 403 })
  }

  // Membro alvo: precisa pertencer à mesma loja do caller (anti-cross-tenant)
  const { data: member, error: fetchError } = await admin
    .from('store_users')
    .select('id, role, is_active')
    .eq('id', id)
    .eq('store_id', caller.store_id)
    .single()

  if (fetchError || !member) {
    return NextResponse.json({ error: 'Membro não encontrado.' }, { status: 404 })
  }

  if (member.role === 'owner') {
    return NextResponse.json({ error: 'O owner não pode ser removido.' }, { status: 403 })
  }

  const { error } = await admin
    .from('store_users')
    .update({ is_active: false })
    .eq('id', id)
    .eq('store_id', caller.store_id)

  if (error) {
    console.error('[DELETE /api/team/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
