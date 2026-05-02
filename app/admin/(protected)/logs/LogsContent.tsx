'use client'

import { useState, useEffect, useRef } from 'react'
import { Loader2, CheckCircle2, XCircle, Radio, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fetchAgent, getSseTicket, buildSseUrl } from '@/lib/agent/fetchAgent'

interface LogEntry {
  id: string
  session_id: string
  phone: string
  step: string
  status: 'ok' | 'error'
  data?: Record<string, unknown>
  duration_ms?: number
  created_at: string
}

const STEP_LABELS: Record<string, string> = {
  webhook_received:  'Mensagem recebida',
  history_loaded:    'Histórico carregado',
  rag_search:        'Busca de conhecimento',
  openai_called:     'OpenAI chamado',
  response_sent:     'Resposta enviada',
  follow_up_sent:    'Follow-up enviado',
  greeting_sent:     'Boas-vindas enviadas',
  photos_sent:       'Fotos enviadas',
  media_download:    'Download de mídia',
  whisper_transcribed: 'Áudio transcrito',
  vision_analyzed:   'Imagem analisada',
  transbordo:        'Transferência p/ humano',
  error:             'Erro',
}

function groupBySessions(logs: LogEntry[]) {
  const sessions = new Map<string, LogEntry[]>()
  for (const log of logs) {
    const existing = sessions.get(log.session_id) ?? []
    existing.push(log)
    sessions.set(log.session_id, existing)
  }
  return Array.from(sessions.entries()).map(([id, steps]) => ({
    id,
    phone: steps[0].phone,
    created_at: steps[0].created_at,
    steps: steps.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    hasError: steps.some(s => s.status === 'error'),
  }))
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `há ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

export function LogsContent({ storeId }: { storeId: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  async function loadLogs() {
    setLoading(true)
    try {
      const res = await fetchAgent('/logs?limit=200')
      const data = await res.json() as LogEntry[]
      setLogs(data)
    } finally {
      setLoading(false)
    }
  }

  async function startLive() {
    if (esRef.current) { esRef.current.close() }
    try {
      const ticket = await getSseTicket()
      const es = new EventSource(buildSseUrl('/logs/stream', ticket))
      es.onmessage = (e) => {
        try {
          const log = JSON.parse(e.data) as LogEntry
          setLogs(prev => [log, ...prev].slice(0, 300))
        } catch { /* ignorar */ }
      }
      es.onerror = () => {
        // Ticket expira em 60s — reconectar com novo ticket.
        es.close()
        if (esRef.current === es) {
          esRef.current = null
          setLive(false)
        }
      }
      esRef.current = es
      setLive(true)
    } catch {
      setLive(false)
    }
  }

  function stopLive() {
    esRef.current?.close()
    esRef.current = null
    setLive(false)
  }

  useEffect(() => {
    loadLogs()
    return () => { esRef.current?.close() }
  }, [storeId])

  const sessions = groupBySessions(logs)

  return (
    <div className="max-w-3xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{logs.length} execuções carregadas</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadLogs} className="h-8 text-xs gap-1.5">
            <RefreshCw size={12} />
            Atualizar
          </Button>
          {live ? (
            <Button size="sm" onClick={stopLive} className="h-8 text-xs gap-1.5 bg-red-500 hover:bg-red-600 text-white">
              <Radio size={12} className="animate-pulse" />
              Ao vivo — parar
            </Button>
          ) : (
            <Button size="sm" onClick={startLive} className="h-8 text-xs gap-1.5"
              style={{ background: 'var(--ds-primary-600)' }}>
              <Radio size={12} />
              Ao vivo
            </Button>
          )}
        </div>
      </div>

      {/* Logs */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-xl gap-2">
          <p className="text-sm text-muted-foreground">Nenhum log ainda.</p>
          <p className="text-xs text-muted-foreground">Os logs aparecerão aqui quando o agente processar mensagens.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map(session => (
            <div key={session.id}
              className={`bg-card border rounded-xl shadow-sm overflow-hidden transition-all ${session.hasError ? 'border-red-200' : 'border-border'}`}>
              {/* Session header */}
              <button
                onClick={() => setExpanded(expanded === session.id ? null : session.id)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  {session.hasError
                    ? <XCircle size={15} className="text-red-500 shrink-0" />
                    : <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />}
                  <div>
                    <span className="text-sm font-medium text-slate-900">{session.phone}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{session.steps.length} etapas</span>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{timeAgo(session.created_at)}</span>
              </button>

              {/* Steps */}
              {expanded === session.id && (
                <div className="border-t border-border">
                  {session.steps.map((step, i) => (
                    <div key={step.id}
                      className={`flex items-start gap-3 px-4 py-2.5 text-xs ${i < session.steps.length - 1 ? 'border-b border-slate-50' : ''}`}>
                      <div className="mt-0.5 shrink-0">
                        {step.status === 'ok'
                          ? <CheckCircle2 size={12} className="text-emerald-500" />
                          : <XCircle size={12} className="text-red-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-700">
                            {STEP_LABELS[step.step] ?? step.step}
                          </span>
                          {step.duration_ms !== undefined && (
                            <span className="text-muted-foreground shrink-0">{step.duration_ms}ms</span>
                          )}
                        </div>
                        {step.data && (
                          <div className="mt-1 text-muted-foreground space-y-0.5">
                            {Object.entries(step.data).map(([k, v]) => (
                              <div key={k} className="truncate">
                                <span className="text-slate-500">{k}:</span>{' '}
                                <span>{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
