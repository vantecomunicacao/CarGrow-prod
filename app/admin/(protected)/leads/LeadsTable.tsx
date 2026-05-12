'use client'

import { useState } from 'react'
import type { Lead } from './LeadsContent'
import { SOURCE_MAP, getStatusMeta, formatDate, formatRelative, formatDuration, getVehicleName } from './leadsUtils'

type Props = {
  leads: Lead[]
  togglingAi: string | null
  onToggleAi: (lead: Lead) => void
  onUpdateStatus: (lead: Lead) => void
  onDelete: (lead: Lead) => void
  onClearChat: (lead: Lead) => void
  emptyMessage: string
}

export default function LeadsTable({ leads, togglingAi, onToggleAi, onUpdateStatus, onDelete, onClearChat, emptyMessage }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (leads.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        <div className="py-16 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Contato</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Interesse</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Origem</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Bot</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Data</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Ações</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead, i) => {
              const statusMeta = getStatusMeta(lead.status)
              const sourceMeta = SOURCE_MAP[lead.source] ?? { label: lead.source, className: 'bg-gray-100 text-gray-500' }
              const isExpanded = expandedId === lead.id
              const isLast = i === leads.length - 1
              return (
                <>
                  <tr
                    key={lead.id}
                    onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                    className={`border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer ${isExpanded ? 'bg-muted/20' : ''} ${isLast && !isExpanded ? 'border-b-0' : ''}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-muted-foreground transition-transform text-[10px] ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                        <div>
                          <div className="font-medium text-foreground">{lead.name ?? '—'}</div>
                          <div className="text-xs text-muted-foreground">{lead.phone ?? '—'}</div>
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 max-w-[220px]">
                      <div className="font-medium text-foreground truncate">{getVehicleName(lead)}</div>
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        {lead.budget && <span className="text-[10px] text-muted-foreground truncate">Orçamento: {lead.budget}</span>}
                        {lead.payment_method && <span className="text-[10px] text-muted-foreground truncate">{lead.payment_method}</span>}
                        {lead.trade_in && <span className="text-[10px] text-muted-foreground truncate">Troca: {lead.trade_in}</span>}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${sourceMeta.className}`}>
                        {sourceMeta.label}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${statusMeta.className}`}>
                        {statusMeta.label}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        <button
                          onClick={e => { e.stopPropagation(); onToggleAi(lead) }}
                          disabled={togglingAi === lead.id}
                          title={lead.ai_active ? 'IA ativa — clique para pausar' : 'IA pausada — clique para reativar'}
                          className={`text-xs font-medium px-2 py-0.5 rounded-full transition-colors ${
                            lead.ai_active
                              ? 'bg-emerald-100 text-emerald-700 hover:bg-red-100 hover:text-red-700'
                              : 'bg-gray-100 text-gray-500 hover:bg-emerald-100 hover:text-emerald-700'
                          }`}
                        >
                          {togglingAi === lead.id ? '...' : lead.ai_active ? 'Ativa' : 'Pausada'}
                        </button>
                        {!lead.ai_active && lead.ai_paused_reason && (
                          <span className="text-[10px] text-muted-foreground leading-none px-1">
                            {lead.ai_paused_reason === 'transbordo' && 'pediu humano'}
                            {lead.ai_paused_reason === 'encerramento' && 'conversa encerrada'}
                            {lead.ai_paused_reason === 'manual' && 'pausado manualmente'}
                            {lead.ai_paused_reason === 'whatsapp_label' && 'pausado pela etiqueta'}
                            {lead.ai_paused_reason === 'rate_limit' && 'rate limit (reativa em 1h)'}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {formatDate(lead.created_at)}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={e => { e.stopPropagation(); onUpdateStatus(lead) }}
                          className="text-xs text-ds-primary-600 hover:text-ds-primary-800 font-medium underline underline-offset-2"
                        >
                          Atualizar status
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); onClearChat(lead) }}
                          className="text-xs text-amber-600 hover:text-amber-800 font-medium underline underline-offset-2"
                        >
                          Apagar conversa
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); onDelete(lead) }}
                          className="text-xs text-red-500 hover:text-red-700 font-medium underline underline-offset-2"
                        >
                          Apagar
                        </button>
                      </div>
                    </td>
                  </tr>

                  {isExpanded && (
                    <tr key={`${lead.id}-detail`} className={`bg-slate-50 border-b border-border/50 ${isLast ? 'border-b-0' : ''}`}>
                      <td colSpan={7} className="px-6 py-4">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground font-medium uppercase tracking-wide text-[10px]">Follow-ups enviados</span>
                            <span className="text-foreground font-semibold text-sm">{lead.follow_up_total ?? 0}</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground font-medium uppercase tracking-wide text-[10px]">Último follow-up</span>
                            <span className="text-foreground font-semibold text-sm">{formatRelative(lead.last_follow_up_at)}</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground font-medium uppercase tracking-wide text-[10px]">Última msg do lead</span>
                            <span className="text-foreground font-semibold text-sm">{formatRelative(lead.last_user_message_at)}</span>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground font-medium uppercase tracking-wide text-[10px]">Tempo sem resposta</span>
                            <span className="text-foreground font-semibold text-sm">{formatDuration(lead.last_user_message_at)}</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
