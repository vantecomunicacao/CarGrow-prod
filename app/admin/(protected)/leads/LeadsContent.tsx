'use client'

import { useEffect, useRef, useState } from 'react'
import { LayoutList, LayoutGrid } from 'lucide-react'
import LeadsTable from './LeadsTable'
import LeadsKanban from './LeadsKanban'
import { STATUS_OPTIONS } from './leadsUtils'

type Vehicle = { brand: string; model: string; year_model: number }

export type Lead = {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  source: 'whatsapp' | 'vitrine' | 'manual' | string
  status: 'new' | 'qualifying' | 'negotiating' | 'closing' | 'converted' | 'lost' | string
  ai_active: boolean
  ai_paused_reason: 'transbordo' | 'encerramento' | 'manual' | 'whatsapp_label' | 'rate_limit' | null
  vehicle_interest: string | null
  budget: string | null
  payment_method: string | null
  trade_in: string | null
  created_at: string
  updated_at: string
  follow_up_total: number | null
  follow_up_count: number | null
  last_follow_up_at: string | null
  last_user_message_at: string | null
  vehicles: Vehicle[] | null
}

type View = 'table' | 'kanban'
const VIEW_STORAGE_KEY = 'leads-view'

export default function LeadsContent({ leads }: { leads: Lead[] }) {
  const [view, setView] = useState<View>('table')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState('')
  const [localLeads, setLocalLeads] = useState<Lead[]>(leads)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [togglingAi, setTogglingAi] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [clearingChatId, setClearingChatId] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const clearChatDialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY)
    if (stored === 'table' || stored === 'kanban') setView(stored)
  }, [])

  function changeView(next: View) {
    setView(next)
    localStorage.setItem(VIEW_STORAGE_KEY, next)
  }

  async function handleToggleAi(lead: Lead) {
    setTogglingAi(lead.id)
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_active: !lead.ai_active }),
      })
      if (res.ok) {
        setLocalLeads(prev => prev.map(l => l.id === lead.id ? { ...l, ai_active: !lead.ai_active } : l))
      }
    } finally {
      setTogglingAi(null)
    }
  }

  const filtered = localLeads.filter(lead => {
    const matchStatus = view === 'kanban' || statusFilter === 'all' || lead.status === statusFilter
    const q = search.toLowerCase()
    const matchSearch = !q
      || (lead.name ?? '').toLowerCase().includes(q)
      || (lead.phone ?? '').includes(q)
    return matchStatus && matchSearch
  })

  function openDialog(lead: Lead) {
    setUpdatingId(lead.id)
    setSelectedStatus(lead.status)
    setErrorMsg('')
    dialogRef.current?.showModal()
  }

  function closeDialog() {
    dialogRef.current?.close()
    setUpdatingId(null)
  }

  function openDeleteDialog(lead: Lead) {
    setDeletingId(lead.id)
    deleteDialogRef.current?.showModal()
  }

  function closeDeleteDialog() {
    deleteDialogRef.current?.close()
    setDeletingId(null)
  }

  async function handleDeleteLead() {
    if (!deletingId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/leads/${deletingId}`, { method: 'DELETE' })
      if (res.ok) {
        setLocalLeads(prev => prev.filter(l => l.id !== deletingId))
        closeDeleteDialog()
      }
    } finally {
      setSaving(false)
    }
  }

  function openClearChatDialog(lead: Lead) {
    setClearingChatId(lead.id)
    setErrorMsg('')
    clearChatDialogRef.current?.showModal()
  }

  function closeClearChatDialog() {
    clearChatDialogRef.current?.close()
    setClearingChatId(null)
  }

  async function handleClearChat() {
    if (!clearingChatId) return
    setSaving(true)
    setErrorMsg('')
    try {
      const res = await fetch(`/api/leads/${clearingChatId}/conversation`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorMsg(json.error ?? 'Erro ao apagar conversa.')
        return
      }
      closeClearChatDialog()
    } catch {
      setErrorMsg('Erro de rede. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveStatus() {
    if (!updatingId) return
    setSaving(true)
    setErrorMsg('')
    try {
      const res = await fetch(`/api/leads/${updatingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: selectedStatus }),
      })
      const json = await res.json()
      if (!res.ok) {
        setErrorMsg(json.error ?? 'Erro ao atualizar.')
        return
      }
      setLocalLeads(prev =>
        prev.map(l => l.id === updatingId ? { ...l, status: selectedStatus, updated_at: new Date().toISOString() } : l)
      )
      closeDialog()
    } catch {
      setErrorMsg('Erro de rede. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  const emptyMessage = localLeads.length === 0
    ? 'Nenhum lead cadastrado ainda.'
    : 'Nenhum resultado para os filtros aplicados.'

  return (
    <div>
      {/* Filters + view toggle */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {view === 'table' && (
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ds-primary-300"
          >
            <option value="all">Todos os status</option>
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}

        <input
          type="text"
          placeholder="Buscar por nome ou telefone..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ds-primary-300 min-w-[220px]"
        />

        <div className="ml-auto inline-flex items-center border border-border rounded-lg bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => changeView('table')}
            title="Visualização em tabela"
            aria-pressed={view === 'table'}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
              view === 'table'
                ? 'bg-ds-primary-600 text-white'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            <LayoutList size={14} />
            Tabela
          </button>
          <button
            type="button"
            onClick={() => changeView('kanban')}
            title="Visualização em Kanban"
            aria-pressed={view === 'kanban'}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
              view === 'kanban'
                ? 'bg-ds-primary-600 text-white'
                : 'text-foreground hover:bg-muted'
            }`}
          >
            <LayoutGrid size={14} />
            Kanban
          </button>
        </div>
      </div>

      {/* Conteúdo */}
      {view === 'table' ? (
        <LeadsTable
          leads={filtered}
          togglingAi={togglingAi}
          onToggleAi={handleToggleAi}
          onUpdateStatus={openDialog}
          onDelete={openDeleteDialog}
          onClearChat={openClearChatDialog}
          emptyMessage={emptyMessage}
        />
      ) : (
        <LeadsKanban
          leads={filtered}
          togglingAi={togglingAi}
          onToggleAi={handleToggleAi}
          onUpdateStatus={openDialog}
          onDelete={openDeleteDialog}
          onClearChat={openClearChatDialog}
          emptyMessage={emptyMessage}
        />
      )}

      {/* Native Dialog — update status */}
      <dialog
        ref={dialogRef}
        className="rounded-xl shadow-xl border border-border bg-card p-0 w-full max-w-sm backdrop:bg-black/40"
        onClose={closeDialog}
      >
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Atualizar status do lead</h2>
        </div>
        <div className="px-5 py-4 flex flex-col gap-3">
          <label className="text-sm font-medium text-foreground">
            Novo status
          </label>
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="border border-border rounded-lg px-3 py-2 text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ds-primary-300"
          >
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {errorMsg && (
            <p className="text-xs text-red-600">{errorMsg}</p>
          )}
        </div>
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button
            type="button"
            onClick={closeDialog}
            className="px-4 py-2 text-sm rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSaveStatus}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-ds-primary-600 hover:bg-ds-primary-700 text-white font-medium transition-colors disabled:opacity-60"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </dialog>

      {/* Native Dialog — confirmar apagar conversa */}
      <dialog
        ref={clearChatDialogRef}
        className="rounded-xl shadow-xl border border-border bg-card p-0 w-full max-w-sm backdrop:bg-black/40"
        onClose={closeClearChatDialog}
      >
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Apagar conversa</h2>
        </div>
        <div className="px-5 py-4 flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Todo o histórico de mensagens deste lead com a IA será apagado. O lead permanece e a IA recomeçará do zero na próxima mensagem.
          </p>
          {errorMsg && (
            <p className="text-xs text-red-600">{errorMsg}</p>
          )}
        </div>
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button
            type="button"
            onClick={closeClearChatDialog}
            className="px-4 py-2 text-sm rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleClearChat}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors disabled:opacity-60"
          >
            {saving ? 'Apagando...' : 'Apagar conversa'}
          </button>
        </div>
      </dialog>

      {/* Native Dialog — confirmar exclusão */}
      <dialog
        ref={deleteDialogRef}
        className="rounded-xl shadow-xl border border-border bg-card p-0 w-full max-w-sm backdrop:bg-black/40"
        onClose={closeDeleteDialog}
      >
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Apagar lead</h2>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-muted-foreground">Esta ação é irreversível. Deseja realmente apagar este lead?</p>
        </div>
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button
            type="button"
            onClick={closeDeleteDialog}
            className="px-4 py-2 text-sm rounded-lg border border-border bg-background hover:bg-muted text-foreground transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDeleteLead}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors disabled:opacity-60"
          >
            {saving ? 'Apagando...' : 'Apagar'}
          </button>
        </div>
      </dialog>
    </div>
  )
}
