'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Smartphone, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { fetchAgent } from '@/lib/agent/fetchAgent'

interface Props {
  storeId: string
}

type Status = 'idle' | 'loading' | 'qr' | 'connected' | 'error'

function useWhatsAppInstance(_storeId: string, mode: 'main' | 'test') {
  const [status, setStatus] = useState<Status>('idle')
  const [qr, setQr] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)

  const qrEndpoint    = mode === 'test' ? 'qr-test'         : 'qr'
  const statusEndpoint = mode === 'test' ? 'status-test'    : 'status'
  const disconnectEndpoint = mode === 'test' ? 'disconnect-test' : 'disconnect'

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetchAgent(`/whatsapp/${statusEndpoint}`)
      const data = await res.json() as { connected?: boolean }
      if (data.connected) {
        setStatus('connected')
        setPolling(false)
      }
    } catch {
      // silencioso
    }
  }, [statusEndpoint])

  useEffect(() => {
    if (!polling) return
    const interval = setInterval(checkConnection, 3000)
    return () => clearInterval(interval)
  }, [polling, checkConnection])

  useEffect(() => {
    checkConnection()
  }, [checkConnection])

  async function handleConnect() {
    setStatus('loading')
    setQr(null)
    try {
      const res = await fetchAgent(`/whatsapp/${qrEndpoint}`)
      const data = await res.json() as { connected?: boolean; qr?: string; qrcode?: string }
      if (data.connected) { setStatus('connected'); return }
      const qrCode = data.qr ?? data.qrcode
      if (qrCode) { setQr(qrCode); setStatus('qr'); setPolling(true) }
      else setStatus('error')
    } catch {
      setStatus('error')
    }
  }

  async function handleDisconnect() {
    setStatus('loading')
    setPolling(false)
    try {
      await fetchAgent(`/whatsapp/${disconnectEndpoint}`, { method: 'DELETE' })
      setStatus('idle')
      setQr(null)
    } catch {
      setStatus('error')
    }
  }

  return { status, qr, handleConnect, handleDisconnect }
}

function WhatsAppCard({
  label,
  badge,
  icon,
  storeId,
  mode,
}: {
  label: string
  badge?: React.ReactNode
  icon: React.ReactNode
  storeId: string
  mode: 'main' | 'test'
}) {
  const { status, qr, handleConnect, handleDisconnect } = useWhatsAppInstance(storeId, mode)

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm font-medium text-slate-900">{label}</p>
        {badge}
      </div>

      {status === 'connected' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle2 size={16} />
            <span className="text-sm font-medium">WhatsApp conectado</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDisconnect}
            className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 h-8 text-xs"
          >
            <XCircle size={13} className="mr-1.5" />
            Desconectar
          </Button>
        </div>
      )}

      {status === 'qr' && qr && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Abra o WhatsApp no celular → <strong>Dispositivos conectados</strong> → <strong>Conectar dispositivo</strong> e escaneie:
          </p>
          <div className="flex justify-center">
            <img
              src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
              alt="QR Code WhatsApp"
              className="w-52 h-52 rounded-xl border border-border"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            Aguardando conexão...
          </div>
          <Button variant="ghost" size="sm" onClick={handleConnect} className="h-8 text-xs gap-1.5">
            <RefreshCw size={12} />
            Gerar novo QR
          </Button>
        </div>
      )}

      {(status === 'idle' || status === 'error') && (
        <div className="space-y-2">
          {status === 'error' && (
            <p className="text-xs text-red-500">Erro ao conectar. Tente novamente.</p>
          )}
          <Button size="sm" onClick={handleConnect} className="h-8 text-xs gap-1.5">
            <Smartphone size={13} />
            Conectar WhatsApp
          </Button>
        </div>
      )}

      {status === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" />
          Processando...
        </div>
      )}
    </div>
  )
}

export function WhatsAppConnect({ storeId }: Props) {
  return (
    <div className="space-y-3">
      <WhatsAppCard
        label="Conexão WhatsApp"
        icon={<Smartphone size={15} className="text-muted-foreground" />}
        storeId={storeId}
        mode="main"
      />
    </div>
  )
}
