import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const envFile = fs.readFileSync('.env.local', 'utf-8')
const env: Record<string, string> = {}
envFile.split('\n').forEach(line => {
  const parts = line.split('=')
  if (parts.length >= 2) {
    const key = parts[0].trim()
    const value = parts.slice(1).join('=').trim()
    env[key] = value
  }
})

const url = env['NEXT_PUBLIC_SUPABASE_URL']
const serviceKey = env['SUPABASE_SERVICE_KEY']
const email = 'mktvantecomunicacao@gmail.com'

async function fixData() {
  console.log('--- OPERAÇÃO RESGATE: BANCO DE DADOS ---')
  const admin = createClient(url!, serviceKey!)

  // 1. Localizar usuário no Auth
  console.log('1. Localizando usuário no Auth...')
  const { data: { users }, error: listError } = await admin.auth.admin.listUsers()
  const user = users.find(u => u.email === email)

  if (listError || !user) {
    console.log('❌ Usuário não encontrado no Auth do Supabase.')
    process.exit(1)
  }
  console.log('✅ Usuário encontrado ID:', user.id)

  // Removido: Acesso em public.users que não existe.

  // 3. Garantir que existe uma loja com onboarding completo
  console.log('\n3. Verificando/Atualizando Loja...')
  let storeId = ''
  const { data: stores } = await admin.from('stores').select('id').limit(1)
  
  if (stores && stores.length > 0) {
    storeId = stores[0].id
    console.log('✅ Loja existente encontrada:', storeId)
    await admin.from('stores').update({ onboarding_completo: true }).eq('id', storeId)
  } else {
    const slugPlaceholder = `loja-${Date.now().toString().slice(-4)}`
    const { data: newStore, error: storeError } = await admin.from('stores').insert({
      name: 'CarGrow Dealer',
      slug: slugPlaceholder,
      plan: 'pro',
      onboarding_completo: true,
      agent_active: true
    }).select('id').single()

    if (storeError) {
      console.log('❌ Erro ao criar loja:', storeError.message)
      process.exit(1)
    }
    storeId = newStore.id
    console.log('✅ Nova loja criada:', storeId)
  }

  // 4. Vincular usuário à loja
  console.log('\n4. Vinculando usuário à loja (Tabela store_users)...')
  const { error: linkError } = await admin.from('store_users').upsert({
    user_id: user.id,
    store_id: storeId,
    role: 'owner'
  }, { onConflict: 'user_id,store_id' })

  if (linkError) {
    console.log('❌ Erro ao vincular usuário:', linkError.message)
  } else {
    console.log('✅ Vínculo concluído com sucesso!')
  }

  console.log('\n--- DIAGNÓSTICO CONCLUÍDO ---')
  console.log('Tente fazer o login no navegador agora.')
}

fixData()
