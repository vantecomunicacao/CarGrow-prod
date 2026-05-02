'use client'

import { useState, useRef } from 'react'
import { Search, ChevronDown, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'

type Store = {
  id: string
  name: string
  slug: string
  plan: string
  is_active: boolean
  onboarding_completo: boolean
  created_at: string
  city: string | null
  state: string | null
  phone: string | null
  vehicleCount: number
  leadCount: number
}

const planBadge: Record<string, string> = {
  trial: 'bg-gray-100 text-gray-600',
  basic: 'bg-blue-100 text-blue-700',
  pro: 'bg-purple-100 text-purple-700',
  enterprise: 'bg-amber-100 text-amber-700',
}

const plans = ['trial', 'basic', 'pro', 'enterprise']

function PlanBadge({ plan }: { plan: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${planBadge[plan] ?? 'bg-gray-100 text-gray-500'}`}>
      {plan}
    </span>
  )
}

type NewAccountForm = {
  store_name: string
  plan: string
  city: string
  state: string
  phone: string
  email: string
  owner_name: string
  owner_email: string
  owner_password: string
}

const emptyForm: NewAccountForm = {
  store_name: '', plan: 'trial', city: '', state: '', phone: '', email: '',
  owner_name: '', owner_email: '', owner_password: '',
}

export default function StoresContent({ stores }: { stores: Store[] }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [storeList, setStoreList] = useState(stores)
  const [planLoading, setPlanLoading] = useState<string | null>(null)
  const [changingPlanStore, setChangingPlanStore] = useState<Store | null>(null)
  const [selectedPlan, setSelectedPlan] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)
  const newAccountDialogRef = useRef<HTMLDialogElement>(null)
  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const [newAccountForm, setNewAccountForm] = useState<NewAccountForm>(emptyForm)
  const [newAccountLoading, setNewAccountLoading] = useState(false)
  const [newAccountError, setNewAccountError] = useState('')
  const [deletingStore, setDeletingStore] = useState<Store | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const filtered = storeList.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.slug.toLowerCase().includes(search.toLowerCase())
  )

  function openPlanDialog(store: Store) {
    setChangingPlanStore(store)
    setSelectedPlan(store.plan)
    dialogRef.current?.showModal()
  }

  function closeDialog() {
    dialogRef.current?.close()
    setChangingPlanStore(null)
  }

  async function handlePlanChange() {
    if (!changingPlanStore) return
    setPlanLoading(changingPlanStore.id)
    try {
      const res = await fetch(`/api/master/stores/${changingPlanStore.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: selectedPlan }),
      })
      if (res.ok) {
        setStoreList((prev) =>
          prev.map((s) => s.id === changingPlanStore.id ? { ...s, plan: selectedPlan } : s)
        )
        closeDialog()
      }
    } finally {
      setPlanLoading(null)
    }
  }

  async function toggleActive(store: Store) {
    const newValue = !store.is_active
    setStoreList((prev) =>
      prev.map((s) => s.id === store.id ? { ...s, is_active: newValue } : s)
    )
    await fetch(`/api/master/stores/${store.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: newValue }),
    })
  }

  function openDeleteDialog(store: Store) {
    setDeletingStore(store)
    setDeleteConfirmText('')
    setDeleteError('')
    deleteDialogRef.current?.showModal()
  }

  function closeDeleteDialog() {
    deleteDialogRef.current?.close()
    setDeletingStore(null)
    setDeleteConfirmText('')
    setDeleteError('')
  }

  async function handleDeleteStore() {
    if (!deletingStore) return
    setDeleteLoading(true)
    setDeleteError('')
    try {
      const res = await fetch(`/api/master/stores/${deletingStore.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDeleteError(data.error ?? 'Erro ao apagar conta.')
        return
      }
      setStoreList((prev) => prev.filter((s) => s.id !== deletingStore.id))
      closeDeleteDialog()
      router.refresh()
    } finally {
      setDeleteLoading(false)
    }
  }

  async function handleNewAccount(e: React.FormEvent) {
    e.preventDefault()
    setNewAccountLoading(true)
    setNewAccountError('')
    try {
      const res = await fetch('/api/master/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAccountForm),
      })
      const data = await res.json()
      if (!res.ok) { setNewAccountError(data.error); return }
      setStoreList((prev) => [data.store, ...prev])
      newAccountDialogRef.current?.close()
      setNewAccountForm(emptyForm)
      router.refresh()
    } finally {
      setNewAccountLoading(false)
    }
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou slug..."
          className="w-full pl-9 pr-3 h-9 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        </div>
        <button
          onClick={() => { setNewAccountError(''); newAccountDialogRef.current?.showModal() }}
          className="inline-flex items-center gap-1.5 h-9 px-4 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 transition-colors"
        >
          <Plus size={15} />
          Nova conta
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Nome</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Slug</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Plano</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Veículos</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Leads</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Cidade / UF</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Criado em</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((store) => (
                <tr key={store.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-gray-900">{store.name}</td>
                  <td className="px-5 py-3 text-gray-400 font-mono text-xs">{store.slug}</td>
                  <td className="px-5 py-3"><PlanBadge plan={store.plan} /></td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => toggleActive(store)}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors cursor-pointer ${store.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-600 hover:bg-red-200'}`}
                    >
                      {store.is_active ? 'Ativo' : 'Inativo'}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{store.vehicleCount}</td>
                  <td className="px-5 py-3 text-gray-600">{store.leadCount}</td>
                  <td className="px-5 py-3 text-gray-500">
                    {store.city && store.state ? `${store.city} / ${store.state}` : store.city || store.state || '—'}
                  </td>
                  <td className="px-5 py-3 text-gray-500">
                    {new Date(store.created_at).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => openPlanDialog(store)}
                        className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
                      >
                        Alterar plano <ChevronDown size={12} />
                      </button>
                      <button
                        onClick={() => openDeleteDialog(store)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Apagar conta"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-gray-400 text-sm">
                    Nenhuma loja encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Plan change dialog */}
      <dialog
        ref={dialogRef}
        className="rounded-xl border border-gray-200 shadow-xl p-0 w-full max-w-sm backdrop:bg-black/40"
      >
        <div className="p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-1">Alterar plano</h3>
          {changingPlanStore && (
            <p className="text-sm text-gray-500 mb-4">{changingPlanStore.name}</p>
          )}
          <select
            value={selectedPlan}
            onChange={(e) => setSelectedPlan(e.target.value)}
            className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
          >
            {plans.map((p) => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
          <div className="flex gap-2 mt-4">
            <button
              onClick={closeDialog}
              className="flex-1 h-9 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handlePlanChange}
              disabled={!!planLoading}
              className="flex-1 h-9 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {planLoading ? 'Salvando...' : 'Confirmar'}
            </button>
          </div>
        </div>
      </dialog>

      {/* New account dialog */}
      <dialog
        ref={newAccountDialogRef}
        className="rounded-xl border border-gray-200 shadow-xl p-0 w-full max-w-lg backdrop:bg-black/40"
      >
        <form onSubmit={handleNewAccount}>
          <div className="p-5">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Nova conta</h3>

            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Dados da loja</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Nome da loja *</label>
                  <input
                    type="text"
                    required
                    value={newAccountForm.store_name}
                    onChange={(e) => setNewAccountForm((f) => ({ ...f, store_name: e.target.value }))}
                    className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                    placeholder="Ex: Carros Premium SP"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Plano</label>
                    <select
                      value={newAccountForm.plan}
                      onChange={(e) => setNewAccountForm((f) => ({ ...f, plan: e.target.value }))}
                      className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                    >
                      {plans.map((p) => (
                        <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Telefone</label>
                    <input
                      type="text"
                      value={newAccountForm.phone}
                      onChange={(e) => setNewAccountForm((f) => ({ ...f, phone: e.target.value }))}
                      className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                      placeholder="(11) 99999-9999"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Cidade</label>
                    <input
                      type="text"
                      value={newAccountForm.city}
                      onChange={(e) => setNewAccountForm((f) => ({ ...f, city: e.target.value }))}
                      className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                      placeholder="São Paulo"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">UF</label>
                    <input
                      type="text"
                      maxLength={2}
                      value={newAccountForm.state}
                      onChange={(e) => setNewAccountForm((f) => ({ ...f, state: e.target.value.toUpperCase() }))}
                      className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                      placeholder="SP"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">ADM da conta</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Nome completo *</label>
                  <input
                    type="text"
                    required
                    value={newAccountForm.owner_name}
                    onChange={(e) => setNewAccountForm((f) => ({ ...f, owner_name: e.target.value }))}
                    className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                    placeholder="Nome do responsável"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">E-mail *</label>
                  <input
                    type="email"
                    required
                    value={newAccountForm.owner_email}
                    onChange={(e) => setNewAccountForm((f) => ({ ...f, owner_email: e.target.value }))}
                    className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                    placeholder="adm@loja.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Senha *</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newAccountForm.owner_password}
                    onChange={(e) => setNewAccountForm((f) => ({ ...f, owner_password: e.target.value }))}
                    className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                    placeholder="Mínimo 6 caracteres"
                  />
                </div>
              </div>
            </div>

            {newAccountError && (
              <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {newAccountError}
              </p>
            )}

            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => newAccountDialogRef.current?.close()}
                className="flex-1 h-9 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={newAccountLoading}
                className="flex-1 h-9 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {newAccountLoading ? 'Criando...' : 'Criar conta'}
              </button>
            </div>
          </div>
        </form>
      </dialog>

      {/* Delete confirm dialog */}
      <dialog
        ref={deleteDialogRef}
        className="rounded-xl border border-gray-200 shadow-xl p-0 w-full max-w-md backdrop:bg-black/40"
      >
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="shrink-0 w-9 h-9 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
              <AlertTriangle size={18} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Apagar conta</h3>
              <p className="text-sm text-gray-500 mt-0.5">Esta ação é permanente e não pode ser desfeita.</p>
            </div>
          </div>

          {deletingStore && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 mb-4">
              <p className="text-sm font-medium text-gray-900">{deletingStore.name}</p>
              <p className="text-xs text-gray-500 font-mono mt-0.5">{deletingStore.slug}</p>
            </div>
          )}

          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 mb-4 text-xs text-red-700">
            <p className="font-medium mb-1">Tudo abaixo será apagado:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>{deletingStore?.vehicleCount ?? 0} veículo(s) e suas fotos</li>
              <li>{deletingStore?.leadCount ?? 0} lead(s) e conversas do agente</li>
              <li>Logo, banner e demais arquivos da loja</li>
              <li>Usuários vinculados apenas a esta loja</li>
            </ul>
          </div>

          <label className="block text-xs font-medium text-gray-700 mb-1">
            Para confirmar, digite o nome da loja: <strong>{deletingStore?.name}</strong>
          </label>
          <input
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            className="w-full h-9 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
            placeholder={deletingStore?.name ?? ''}
            autoComplete="off"
          />

          {deleteError && (
            <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {deleteError}
            </p>
          )}

          <div className="flex gap-2 mt-5">
            <button
              onClick={closeDeleteDialog}
              disabled={deleteLoading}
              className="flex-1 h-9 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleDeleteStore}
              disabled={deleteLoading || deleteConfirmText !== deletingStore?.name}
              className="flex-1 h-9 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {deleteLoading ? 'Apagando...' : 'Apagar conta'}
            </button>
          </div>
        </div>
      </dialog>
    </>
  )
}
