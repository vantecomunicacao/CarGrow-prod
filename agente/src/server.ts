import 'dotenv/config'
import express, { type Request, type Response } from 'express'
import cors, { type CorsOptions } from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { enqueueMessage, enqueueMedia } from './agent'
import { isBotSentMessage, markAsRead, sendReply, sendPresenceOnce, findLabels, sendMessage } from './evolution'
import { streamLogsToClient } from './logger'
import { createOrGetQR, checkStatus, disconnectInstance, instanceName, configureWebhook } from './whatsapp'
import { supabase } from './db'
import { addKnowledge, deleteKnowledge, listKnowledge } from './rag'
import { runFollowUpCycle } from './followup'
import { safeDecrypt } from './crypto'
import { requireAuth, requireSseTicket, requireWebhookSecret } from './auth/middleware'
import { signTicket } from './auth/sseTicket'
import { runHealthchecks, dispatchAlert } from './healthcheck'
import crypto from 'crypto'

// ── Tratamento Global de Erros ───────────────────────────────────────────────
// Evita que o processo morra em caso de exceções não tratadas em tarefas de fundo
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason)
})

async function getInstanceName(storeId: string): Promise<string> {
  const { data } = await supabase.from('stores').select('whatsapp_instance').eq('id', storeId).single()
  return data?.whatsapp_instance ?? instanceName(storeId)
}

const app = express()
app.set('trust proxy', 1)

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    // Requests sem origin (curl, server-side, webhooks) são permitidos —
    // a autenticação por rota cuida deles.
    if (!origin) return cb(null, true)
    if (allowedOrigins.length === 0) return cb(null, true)
    if (allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} não permitida`))
  },
  credentials: false,
}

app.use(helmet({
  // API consumida por outras origens (Next.js, painel master). O CORS já controla
  // quem pode ler a resposta — CORP/COEP padrão do helmet bloqueariam o browser.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
}))
app.use(cors(corsOptions))
app.use(express.json({ limit: '50mb' }))

const adminLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
})

const webhookLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
})

app.use('/webhook', webhookLimiter)
app.use('/whatsapp', adminLimiter)
app.use('/knowledge', adminLimiter)
app.use('/labels', adminLimiter)
app.use('/logs', adminLimiter)
app.use('/auth', adminLimiter)
app.use('/salespeople', adminLimiter)

const PORT = process.env.AGENT_PORT ?? 3001

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

// Deduplicação de mensagens não suportadas (Evolution envia 2x o mesmo messageId)
const unsupportedHandled = new Set<string>()

// ── Handler: associação de label a um chat ───────────────────────────────────
// Quando o usuário adiciona/remove a "label de desligamento" do chat no app,
// pausa/reativa o bot para aquele lead.
async function handleLabelAssociation(
  instance: string,
  data: { chatId?: string; remoteJid?: string; labelId?: string; type?: string; association?: string },
): Promise<void> {
  const remoteJid: string = data?.chatId ?? data?.remoteJid ?? ''
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) return
  const phone = remoteJid.replace('@s.whatsapp.net', '')
  if (!phone) return

  const labelId: string = String(data?.labelId ?? '')
  if (!labelId) return

  // Evolution às vezes manda 'type', às vezes 'association' — ambos com 'add'|'remove'
  const action = (data?.type ?? data?.association ?? '').toLowerCase()
  if (action !== 'add' && action !== 'remove') return

  const { data: store } = await supabase
    .from('stores')
    .select('id, bot_disable_label_id')
    .eq('whatsapp_instance', instance)
    .single()

  if (!store?.bot_disable_label_id) return
  if (String(store.bot_disable_label_id) !== labelId) return

  if (action === 'add') {
    await supabase.from('leads')
      .update({ ai_active: false, ai_paused_reason: 'whatsapp_label' })
      .eq('store_id', store.id)
      .eq('phone', phone)
  } else {
    await supabase.from('leads')
      .update({ ai_active: true, ai_paused_reason: null })
      .eq('store_id', store.id)
      .eq('phone', phone)
      .eq('ai_paused_reason', 'whatsapp_label')
  }
}

// ── Webhook Evolution API ─────────────────────────────────────────────────────
function handleEvolutionWebhook(req: Request, res: Response): void {
  res.sendStatus(200)

  const body = req.body
  const instance: string = body.instance ?? ''

  const event: string = (body.event ?? '').toLowerCase().replace('.', '_')

  // CONNECTION_UPDATE — apenas loga, NÃO desliga o agente automaticamente
  if (event === 'connection_update') {
    const state: string = body.data?.state ?? ''
    console.log(`[agente] Status de conexão da instância ${instance}: ${state}`)
    // Removido o desligamento automático a pedido do usuário
    return
  }

  // LABELS_ASSOCIATION — etiqueta adicionada/removida de um chat no WhatsApp
  if (event === 'labels_association') {
    handleLabelAssociation(instance, body.data).catch((err: unknown) => {
      console.error('[agente] erro em labels_association:', err)
    })
    return
  }

  // LABELS_EDIT — usuário criou/editou/removeu uma label no app
  // Não tratamos em tempo real: o usuário re-sincroniza pelo painel quando quiser.
  if (event === 'labels_edit') return

  if (event !== 'messages_upsert') return

  const data = body.data
  if (!data) return

  const remoteJid: string = data.key?.remoteJid ?? ''
  // Ignora mensagens de grupos e broadcasts
  if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) return
  const phone: string | undefined = remoteJid.replace('@s.whatsapp.net', '') || undefined
  if (!phone) return

  const messageId: string = data.key?.id ?? ''

  // fromMe = mensagem enviada pelo próprio número (bot ou atendente humano)
  if (data.key?.fromMe === true) {
    // Se NÃO foi o bot que enviou, é um atendente humano — registra para cooldown
    if (messageId && phone && !isBotSentMessage(messageId)) {
      ;(async () => {
        const { data: storeRow } = await supabase.from('stores').select('id').eq('whatsapp_instance', instance).single()
        if (storeRow) {
          await supabase.from('leads')
            .update({ last_human_message_at: new Date().toISOString() })
            .eq('store_id', storeRow.id)
            .eq('phone', phone)
        }
      })().catch(console.error)
    }
    return
  }
  const messageType: string = data.messageType ?? ''


  // Marca como lida (usa instância real do Evolution API)
  if (messageId) markAsRead(instance, remoteJid, messageId)

  // Texto
  const textMessage: string | undefined =
    data.message?.conversation ??
    data.message?.extendedTextMessage?.text

  if (textMessage) {
    enqueueMessage({ instance, phone, message: textMessage, pushName: data.pushName, messageId })
    return
  }

  // Áudio
  if (messageType === 'audioMessage' && messageId) {
    enqueueMedia({ instance, phone, remoteJid, pushName: data.pushName, messageId, mediaType: 'audio' })
    return
  }

  // Imagem
  if (messageType === 'imageMessage' && messageId) {
    const caption = data.message?.imageMessage?.caption ?? ''
    enqueueMedia({ instance, phone, remoteJid, pushName: data.pushName, messageId, mediaType: 'image', caption })
    return
  }

  // Mídia não suportada (figurinha, vídeo, documento, etc.)
  const unsupportedTypes: Record<string, string> = {
    stickerMessage: 'figurinha',
    videoMessage: 'vídeo',
    documentMessage: 'documento/PDF',
    documentWithCaptionMessage: 'documento/PDF',
    contactMessage: 'contato',
    contactsArrayMessage: 'contato',
    locationMessage: 'localização',
    liveLocationMessage: 'localização',
    reactionMessage: '',       // reações: ignora silenciosamente
    pollCreationMessage: 'enquete',
    pollUpdateMessage: '',     // ignora silenciosamente
  }

  if (messageType in unsupportedTypes && messageId) {
    const label = unsupportedTypes[messageType]
    if (label && !unsupportedHandled.has(messageId)) {
      unsupportedHandled.add(messageId)
      if (unsupportedHandled.size > 1000) {
        const first = unsupportedHandled.values().next().value
        if (first) unsupportedHandled.delete(first)
      }
      // Não bloqueia o webhook — dispara sem await
      ;(async () => {
        const replyText = 'Poxa, não consigo receber esse tipo de mídia por aqui. Pode me enviar em texto ou áudio, por gentileza? 😊'

        // Delay humanizado antes de responder
        await sendPresenceOnce(instance, remoteJid)
        await new Promise(r => setTimeout(r, 2500 + Math.random() * 1500))

        await sendReply(instance, phone, remoteJid, messageId, replyText)

        // Registra no histórico da conversa
        const { data: store } = await supabase
          .from('stores').select('id').eq('whatsapp_instance', instance).single()
        if (!store) return

        const { data: lead } = await supabase
          .from('leads').select('id').eq('store_id', store.id).eq('phone', phone).single()
        if (!lead) return

        await supabase.from('agent_conversations').insert([
          { lead_id: lead.id, store_id: store.id, phone, role: 'user',      content: `[${label} enviado pelo cliente]` },
          { lead_id: lead.id, store_id: store.id, phone, role: 'assistant', content: replyText },
        ])
      })().catch(() => { /* não crítico */ })
    }
  }
}

// Rota nova com secret no path. Configurar Evolution API para apontar para esta URL.
app.post('/webhook/:secret', requireWebhookSecret, handleEvolutionWebhook)

// Rota legacy sem secret. Mantida por 1 release para transição.
// Remover após confirmar que a Evolution está apontando para /webhook/:secret.
app.post('/webhook', (req, res) => {
  console.warn('[deprecated] POST /webhook sem secret — atualize a Evolution API para /webhook/<secret>')
  handleEvolutionWebhook(req, res)
})

function buildWebhookUrl(): string {
  const base = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET
  if (!secret) {
    throw new Error('EVOLUTION_WEBHOOK_SECRET não configurado — não é possível registrar webhook')
  }
  return `${base}/webhook/${secret}`
}

// `req.storeId` é setado por `requireAuth` (do JWT). Em shadow mode, pode ser
// undefined — caímos para `req.query.store_id` para não quebrar callers legacy.
function resolveStoreId(req: Request): string | undefined {
  return req.storeId ?? (typeof req.query.store_id === 'string' ? req.query.store_id : undefined)
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────
app.get('/whatsapp/qr', requireAuth, async (req, res) => {
  const storeId = resolveStoreId(req)
  if (!storeId) { res.sendStatus(400); return }
  try {
    const webhookUrl = buildWebhookUrl()
    const instance = await getInstanceName(storeId)
    const data = await createOrGetQR(instance, webhookUrl)
    await supabase.from('stores').update({ whatsapp_instance: instance }).eq('id', storeId)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ── WhatsApp TESTE (instância separada, webhook local) ────────────────────────
// Usa store_<id>_test como nome de instância e aponta o webhook para localhost
app.get('/whatsapp/qr-test', requireAuth, async (req, res) => {
  const storeId = resolveStoreId(req)
  if (!storeId) { res.sendStatus(400); return }
  if (!process.env.PUBLIC_URL) {
    res.status(400).json({ error: 'Configure PUBLIC_URL no agente/.env com a URL do ngrok antes de usar o WhatsApp Teste.' })
    return
  }
  try {
    const webhookUrl = buildWebhookUrl()
    const instance = `${await getInstanceName(storeId)}_test`
    const data = await createOrGetQR(instance, webhookUrl)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/whatsapp/status-test', requireAuth, async (req, res) => {
  const storeId = resolveStoreId(req)
  if (!storeId) { res.sendStatus(400); return }
  try {
    const instance = `${await getInstanceName(storeId)}_test`
    res.json(await checkStatus(instance))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.delete('/whatsapp/disconnect-test', requireAuth, async (req, res) => {
  const storeId = resolveStoreId(req)
  if (!storeId) { res.sendStatus(400); return }
  try {
    const instance = `${await getInstanceName(storeId)}_test`
    await disconnectInstance(instance)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/whatsapp/status', requireAuth, async (req, res) => {
  const storeId = resolveStoreId(req)
  if (!storeId) { res.sendStatus(400); return }
  try {
    res.json(await checkStatus(await getInstanceName(storeId)))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.delete('/whatsapp/disconnect', requireAuth, async (req, res) => {
  const storeId = resolveStoreId(req)
  if (!storeId) { res.sendStatus(400); return }
  try {
    await disconnectInstance(await getInstanceName(storeId))
    await supabase.from('stores').update({ whatsapp_instance: null, agent_active: false }).eq('id', storeId)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ── Base de conhecimento ──────────────────────────────────────────────────────
app.get('/knowledge', requireAuth, async (req, res) => {
  const storeId = resolveStoreId(req)
  if (!storeId) { res.sendStatus(400); return }
  try {
    res.json(await listKnowledge(storeId))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/knowledge', requireAuth, async (req, res) => {
  const storeId = resolveStoreId(req) ?? (req.body as { store_id?: string }).store_id
  const { title, content } = req.body as { title: string; content: string }
  if (!storeId || !content) { res.sendStatus(400); return }

  // Busca a API key da loja
  const { data: store } = await supabase.from('stores').select('openai_api_key').eq('id', storeId).single()
  if (!store?.openai_api_key) {
    res.status(400).json({ error: 'Configure a API key OpenAI antes de adicionar conhecimento.' })
    return
  }

  try {
    await addKnowledge(storeId, title, content, safeDecrypt(store.openai_api_key))
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

app.delete('/knowledge/:id', requireAuth, async (req, res) => {
  try {
    // Verifica que o knowledge pertence à loja do usuário (anti-IDOR cross-tenant).
    const storeId = resolveStoreId(req)
    if (storeId && !req.isMaster) {
      const { data: row } = await supabase
        .from('knowledge_base').select('store_id').eq('id', req.params.id).single()
      if (row && row.store_id !== storeId) {
        res.sendStatus(404)
        return
      }
    }
    await deleteKnowledge(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ── Labels (etiquetas WhatsApp Business) ─────────────────────────────────────
app.get('/labels', requireAuth, async (req, res) => {
  const storeId = resolveStoreId(req)
  if (!storeId) { res.sendStatus(400); return }
  const { data } = await supabase
    .from('whatsapp_labels')
    .select('id, evolution_label_id, name, color, synced_at')
    .eq('store_id', storeId)
    .order('name', { ascending: true })
  res.json(data ?? [])
})

app.post('/labels/sync', requireAuth, async (req, res) => {
  const storeId = resolveStoreId(req)
  if (!storeId) { res.sendStatus(400); return }
  try {
    const instance = await getInstanceName(storeId)
    // Garante que o webhook da instância já tem LABELS_ASSOCIATION habilitado
    try {
      const webhookUrl = buildWebhookUrl()
      await configureWebhook(instance, webhookUrl)
    } catch (err) {
      console.warn('[labels/sync] não foi possível reconfigurar webhook:', err)
    }

    const labels = await findLabels(instance)
    const now = new Date().toISOString()
    const rows = labels.map(l => ({
      store_id: storeId,
      evolution_label_id: l.id,
      name: l.name,
      color: l.color ?? null,
      synced_at: now,
    }))

    if (rows.length > 0) {
      const { error } = await supabase
        .from('whatsapp_labels')
        .upsert(rows, { onConflict: 'store_id,evolution_label_id' })
      if (error) throw new Error(error.message)
    }

    // Remove etiquetas que não existem mais no WhatsApp
    const ids = rows.map(r => r.evolution_label_id)
    const delQuery = supabase.from('whatsapp_labels').delete().eq('store_id', storeId)
    if (ids.length > 0) await delQuery.not('evolution_label_id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`)
    else await delQuery

    res.json({ ok: true, count: rows.length })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ── Vendedores: enviar mensagem de teste ─────────────────────────────────────
app.post('/salespeople/test', requireAuth, async (req, res) => {
  const storeId = resolveStoreId(req)
  if (!storeId) { res.sendStatus(400); return }

  const phoneRaw = (req.body as { phone?: string })?.phone
  const phone = typeof phoneRaw === 'string' ? phoneRaw.replace(/\D/g, '') : ''
  if (phone.length < 10) {
    res.status(400).json({ error: 'Telefone inválido.' })
    return
  }

  try {
    const { data: store } = await supabase
      .from('stores')
      .select('whatsapp_instance, agent_name, name')
      .eq('id', storeId)
      .single()

    const instance = store?.whatsapp_instance
    if (!instance) {
      res.status(400).json({ error: 'WhatsApp não está conectado nesta loja.' })
      return
    }

    const storeName = (store?.name as string | null) || (store?.agent_name as string | null) || 'CarGrow'
    const message = `✅ Teste de notificação\n\nVocê foi cadastrado como vendedor na loja *${storeName}* e vai receber leads pelo WhatsApp.\n\nSe recebeu esta mensagem, está tudo certo!`
    await sendMessage(instance as string, phone, message)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
})

// ── Logs: histórico paginado ──────────────────────────────────────────────────
app.get('/logs', requireAuth, async (req, res) => {
  const storeId = resolveStoreId(req)
  const limit = Number(req.query.limit ?? 100)
  if (!storeId) { res.sendStatus(400); return }

  const { data } = await supabase
    .from('agent_logs')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(limit)

  res.json(data ?? [])
})

// ── SSE ticket: troca um Bearer por um ticket curto que o EventSource passa em query ───
app.post('/auth/sse-ticket', requireAuth, (req, res) => {
  const storeId = req.storeId
  if (!storeId) { res.status(400).json({ error: 'no-store-id' }); return }
  const ticket = signTicket(storeId, !!req.isMaster)
  res.json({ ticket })
})

// ── SSE: stream de logs em tempo real (autenticado via ticket em query) ───────
app.get('/logs/stream', requireSseTicket, (req, res) => {
  const storeId = req.storeId ?? (typeof req.query.store_id === 'string' ? req.query.store_id : undefined)
  if (!storeId) { res.sendStatus(400); return }
  streamLogsToClient(storeId, res)
})

// ── Cron interno: chamado pelo pg_cron via pg_net ────────────────────────────
// Único caller esperado: trigger_followup() definido na migration 033.
function requireCronSecret(req: Request, res: Response, next: () => void): void {
  const expected = process.env.CRON_SECRET ?? ''
  const provided = (req.headers['x-cron-secret'] ?? '') as string
  if (!expected) {
    console.error('[cron] CRON_SECRET não configurado — rejeitando')
    res.sendStatus(404)
    return
  }
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.sendStatus(404)
    return
  }
  next()
}

app.post('/internal/cron/followup', requireCronSecret, (_req, res) => {
  res.sendStatus(202)
  runFollowUpCycle().catch(err => console.error('[cron/followup] erro:', err))
})

// ── Cron interno: healthcheck ────────────────────────────────────────────────
// Disparado a cada 15 min pelo pg_cron. Roda os 5 checks server-side e, se
// alguma coisa falhar, posta direto no n8n com payload detalhado.
// Aceita ?force_fail=1 para validar o caminho de alerta sem precisar quebrar o sistema.
app.post('/internal/healthcheck', requireCronSecret, async (req, res) => {
  const forceFail = req.query.force_fail === '1'
  try {
    const report = await runHealthchecks()
    if (forceFail) {
      report.checks.push({
        name: 'force_fail_test',
        ok: false,
        hint: 'Falha forçada via ?force_fail=1 — apenas teste de pipeline de alerta',
      })
      report.failed.push(report.checks[report.checks.length - 1])
      report.ok = false
    }
    if (!report.ok) {
      dispatchAlert(report).catch(err => console.error('[healthcheck] erro no dispatch:', err))
      res.status(503).json({
        status: 'down',
        failed: report.failed.map(c => c.name),
        checks: report.checks,
      })
      return
    }
    res.status(200).json({ status: 'up', checks_passed: report.checks.length })
  } catch (err) {
    console.error('[healthcheck] erro ao rodar checks:', err)
    res.status(500).json({ error: 'healthcheck_internal_error' })
  }
})

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[agente] Serviço rodando em http://localhost:${PORT}`)
  })
}

export default app
