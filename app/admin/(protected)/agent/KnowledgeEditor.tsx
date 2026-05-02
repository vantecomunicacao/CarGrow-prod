'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2, BookOpen } from 'lucide-react'
import { fetchAgent } from '@/lib/agent/fetchAgent'

interface KnowledgeItem {
  id: string
  title: string
  content: string
  created_at: string
}

export function KnowledgeEditor({ storeId }: { storeId: string }) {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', content: '' })

  async function load() {
    setLoading(true)
    try {
      const res = await fetchAgent('/knowledge')
      const data = await res.json() as KnowledgeItem[]
      setItems(Array.isArray(data) ? data : [])
    } catch {
      toast.error('Erro ao carregar base de conhecimento.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [storeId])

  async function handleAdd() {
    if (!form.content.trim()) { toast.error('O conteúdo não pode estar vazio.'); return }
    setSaving(true)
    try {
      const res = await fetchAgent('/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.title, content: form.content }),
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        toast.error(err.error ?? 'Erro ao salvar.')
        return
      }
      toast.success('Conhecimento adicionado!')
      setForm({ title: '', content: '' })
      await load()
    } catch {
      toast.error('Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetchAgent(`/knowledge/${id}`, { method: 'DELETE' })
      setItems(prev => prev.filter(i => i.id !== id))
      toast.success('Removido.')
    } catch {
      toast.error('Erro ao remover.')
    }
  }

  return (
    <div className="space-y-5">
      {/* Adicionar novo */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <Plus size={14} className="text-muted-foreground" />
          <p className="text-sm font-medium text-slate-900">Adicionar conhecimento</p>
        </div>
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">Título (opcional)</Label>
            <Input
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Ex: Política de garantia"
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-600">Conteúdo</Label>
            <Textarea
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              placeholder="Cole aqui textos, FAQs, informações sobre a loja, veículos, preços, condições de pagamento..."
              rows={5}
              className="resize-none text-sm"
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={handleAdd} disabled={saving} className="h-8 text-xs gap-1.5">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Adicionar
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          O agente usará esses textos para responder os clientes com mais precisão. Requer API key OpenAI configurada.
        </p>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-border rounded-xl gap-2">
          <BookOpen size={24} className="text-slate-300" />
          <p className="text-sm text-muted-foreground">Nenhum conhecimento cadastrado ainda.</p>
          <p className="text-xs text-muted-foreground">Adicione informações sobre sua loja, veículos e condições.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div key={item.id} className="bg-card border border-border rounded-xl p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {item.title && (
                    <p className="text-xs font-semibold text-slate-700 mb-1">{item.title}</p>
                  )}
                  <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">{item.content}</p>
                </div>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="text-slate-300 hover:text-red-500 transition-colors shrink-0 mt-0.5"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
