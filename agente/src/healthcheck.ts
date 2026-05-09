import { supabase } from './db'
import { safeDecrypt } from './crypto'
import { checkStatus } from './whatsapp'

export interface CheckResult {
  name: string
  ok: boolean
  expected?: string
  actual?: string
  hint?: string
}

const TIMEOUT_MS = 5000

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(TIMEOUT_MS)
}

async function checkAgentPublicUrl(): Promise<CheckResult> {
  const publicUrl = process.env.PUBLIC_URL
  if (!publicUrl) {
    return { name: 'agent_public_url', ok: false, hint: 'PUBLIC_URL não configurado no agente' }
  }
  try {
    const res = await fetch(`${publicUrl}/health`, { signal: timeoutSignal() })
    if (res.ok) return { name: 'agent_public_url', ok: true }
    return {
      name: 'agent_public_url',
      ok: false,
      expected: '200',
      actual: String(res.status),
      hint: `${publicUrl}/health respondeu ${res.status} — proxy/DNS pode estar quebrado`,
    }
  } catch (err) {
    return {
      name: 'agent_public_url',
      ok: false,
      hint: `Erro de rede ao chamar ${publicUrl}/health: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function checkSupabaseReachable(): Promise<CheckResult> {
  try {
    const { error } = await supabase.from('stores').select('id').limit(1)
    if (error) {
      return { name: 'supabase_reachable', ok: false, hint: `Supabase erro: ${error.message}` }
    }
    return { name: 'supabase_reachable', ok: true }
  } catch (err) {
    return {
      name: 'supabase_reachable',
      ok: false,
      hint: err instanceof Error ? err.message : String(err),
    }
  }
}

async function findTestStore(): Promise<{ id: string; whatsapp_instance: string | null; openai_api_key: string | null } | null> {
  const { data } = await supabase
    .from('stores')
    .select('id, whatsapp_instance, openai_api_key')
    .eq('agent_active', true)
    .not('openai_api_key', 'is', null)
    .limit(1)
    .maybeSingle()
  return data ?? null
}

async function checkEncryptionKey(testStore: { id: string; openai_api_key: string | null } | null): Promise<CheckResult> {
  if (!testStore?.openai_api_key) {
    return { name: 'encryption_key_works', ok: true, hint: 'Nenhuma loja com openai_api_key — não testado' }
  }
  try {
    const decrypted = safeDecrypt(testStore.openai_api_key)
    if (decrypted && decrypted.startsWith('sk-')) {
      return { name: 'encryption_key_works', ok: true }
    }
    return {
      name: 'encryption_key_works',
      ok: false,
      hint: `Decifração de openai_api_key da loja ${testStore.id} retornou valor inesperado — ENCRYPTION_KEY pode ter mudado`,
    }
  } catch (err) {
    return {
      name: 'encryption_key_works',
      ok: false,
      hint: `Falha ao decifrar openai_api_key da loja ${testStore.id}: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function checkEvolutionInstance(testStore: { whatsapp_instance: string | null } | null): Promise<CheckResult> {
  if (!testStore?.whatsapp_instance) {
    return { name: 'evolution_instance_open', ok: true, hint: 'Loja teste sem WhatsApp conectado — não testado' }
  }
  try {
    const status = await checkStatus(testStore.whatsapp_instance)
    if (status.connected) return { name: 'evolution_instance_open', ok: true }
    return {
      name: 'evolution_instance_open',
      ok: false,
      expected: 'open',
      actual: status.state ?? 'unknown',
      hint: `Instância ${testStore.whatsapp_instance} não está conectada ao WhatsApp`,
    }
  } catch (err) {
    return {
      name: 'evolution_instance_open',
      ok: false,
      hint: err instanceof Error ? err.message : String(err),
    }
  }
}

async function checkEvolutionWebhookMatch(testStore: { whatsapp_instance: string | null } | null): Promise<CheckResult> {
  if (!testStore?.whatsapp_instance) {
    return { name: 'evolution_webhook_match', ok: true, hint: 'Loja teste sem WhatsApp — não testado' }
  }
  const publicUrl = process.env.PUBLIC_URL
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET
  if (!publicUrl || !secret) {
    return {
      name: 'evolution_webhook_match',
      ok: false,
      hint: 'PUBLIC_URL ou EVOLUTION_WEBHOOK_SECRET não configurados',
    }
  }
  const expected = `${publicUrl}/webhook/${secret}`
  const evoUrl = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '')
  const evoKey = process.env.EVOLUTION_API_KEY ?? ''
  try {
    const res = await fetch(`${evoUrl}/webhook/find/${testStore.whatsapp_instance}`, {
      headers: { apikey: evoKey },
      signal: timeoutSignal(),
    })
    if (!res.ok) {
      return {
        name: 'evolution_webhook_match',
        ok: false,
        hint: `Evolution /webhook/find respondeu ${res.status}`,
      }
    }
    const body = (await res.json()) as { url?: string; enabled?: boolean }
    if (!body.enabled) {
      return {
        name: 'evolution_webhook_match',
        ok: false,
        expected,
        actual: body.url ?? 'null',
        hint: 'Webhook está desabilitado na Evolution',
      }
    }
    if (body.url !== expected) {
      return {
        name: 'evolution_webhook_match',
        ok: false,
        expected,
        actual: body.url ?? 'null',
        hint: 'URL do webhook não bate com PUBLIC_URL — mensagens estão sendo perdidas',
      }
    }
    return { name: 'evolution_webhook_match', ok: true }
  } catch (err) {
    return {
      name: 'evolution_webhook_match',
      ok: false,
      hint: err instanceof Error ? err.message : String(err),
    }
  }
}

export interface HealthcheckReport {
  ok: boolean
  checks: CheckResult[]
  failed: CheckResult[]
  test_store_id: string | null
}

export async function runHealthchecks(): Promise<HealthcheckReport> {
  const testStore = await findTestStore()

  const checks = await Promise.all([
    checkAgentPublicUrl(),
    checkSupabaseReachable(),
    checkEncryptionKey(testStore),
    checkEvolutionInstance(testStore),
    checkEvolutionWebhookMatch(testStore),
  ])

  const failed = checks.filter(c => !c.ok)
  return {
    ok: failed.length === 0,
    checks,
    failed,
    test_store_id: testStore?.id ?? null,
  }
}

export async function dispatchAlert(report: HealthcheckReport): Promise<void> {
  const url = process.env.N8N_ALERT_URL
  if (!url) {
    console.warn('[healthcheck] N8N_ALERT_URL não configurado — alerta não enviado')
    return
  }
  const payload = {
    source: 'cargrow-healthcheck',
    status: 'down',
    severity: 'critical',
    title: 'CarGrow Agent — falha em healthcheck',
    timestamp: new Date().toISOString(),
    summary: `${report.failed.length} de ${report.checks.length} checks falhando`,
    failed_checks: report.failed.map(c => ({
      name: c.name,
      expected: c.expected ?? null,
      actual: c.actual ?? null,
      hint: c.hint ?? null,
    })),
    system: {
      agent_url: process.env.PUBLIC_URL ?? 'unknown',
      deployment: process.env.NODE_ENV ?? 'unknown',
      store_id_tested: report.test_store_id,
    },
  }
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    console.error('[healthcheck] erro ao enviar alerta para n8n:', err)
  }
}
