'use client'

import { useState, useEffect, useRef } from 'react'
import { useAutoSave } from '@/hooks/useAutoSave'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { Loader2, Bot, Eye, EyeOff, KeyRound, Smartphone, BookOpen, Clock, Settings, RotateCcw, Users } from 'lucide-react'
import { WhatsAppConnect } from './WhatsAppConnect'
import { WhatsAppLabels } from './WhatsAppLabels'
import { KnowledgeEditor } from './KnowledgeEditor'
import { FollowUpConfig } from './FollowUpConfig'
import { AgentHours } from './AgentHours'
import { Salespeople } from './Salespeople'
import { SummaryFieldsEditor } from './SummaryFieldsEditor'
import { buildAgentPrompt } from '@/lib/defaults/agentPrompt'

const PROMPT_VARIABLES: { token: string; description: string }[] = [
  { token: '{{STORE_NAME}}', description: 'Nome da loja' },
  { token: '{{AGENT_NAME}}', description: 'Nome do agente' },
  { token: '{{LOJA_TELEFONE}}', description: 'Telefone da loja' },
  { token: '{{LOJA_CIDADE}}', description: 'Cidade da loja' },
  { token: '{{LOJA_ESTADO}}', description: 'Estado da loja' },
]

interface Props {
  storeId: string
  followUpEnabled: boolean
  followUpConfig: { intervals: number[]; messages: string[] }
  agentHours: Record<string, { enabled: boolean; start: string; end: string }> | null
}


export function AgentContent({ storeId, followUpEnabled, followUpConfig, agentHours }: Props) {
  const [loading, setLoading] = useState(true)
  const [showKey, setShowKey] = useState(false)
  const [msgSizeMode, setMsgSizeMode] = useState<'small' | 'medium' | 'large' | 'custom'>('medium')
  const [storeName, setStoreName] = useState('sua loja')
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null)

  function insertPromptVariable(token: string) {
    const ta = promptTextareaRef.current
    if (!ta) {
      setForm(f => ({ ...f, agent_prompt: (f.agent_prompt ?? '') + token }))
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const current = form.agent_prompt ?? ''
    const next = current.slice(0, start) + token + current.slice(end)
    setForm(f => ({ ...f, agent_prompt: next }))
    requestAnimationFrame(() => {
      ta.focus()
      const cursor = start + token.length
      ta.setSelectionRange(cursor, cursor)
    })
  }
  const FORM_DEFAULTS = {
    agent_active: false,
    agent_name: 'CarGrow',
    agent_tone: 'professional',
    agent_prompt: '',
    openai_api_key: '',
    openai_model: 'gpt-4o-mini',
    agent_context_window: 15,
    agent_debounce_seconds: 3,
    agent_cooldown_minutes: 30,
    agent_rate_limit: 20,
    notification_phone: '',
    agent_max_message_chars: 300,
    agent_typing_speed_ms: 20,
    agent_image_prompt: '',
    agent_end_prompt: '',
    agent_stop_on_end: true,
  }
  const [form, setForm] = useState(FORM_DEFAULTS)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/settings')
        if (res.ok) {
          const { store } = await res.json()
          if (store) {
            const chars: number = store.agent_max_message_chars ?? 300
            const mode = chars === 150 ? 'small' : chars === 300 ? 'medium' : chars === 500 ? 'large' : 'custom'
            setMsgSizeMode(mode as 'small' | 'medium' | 'large' | 'custom')
            if (store.name) setStoreName(store.name)
            const loaded = {
              agent_active: store.agent_active ?? false,
              agent_name: store.agent_name ?? 'CarGrow',
              agent_tone: store.agent_tone ?? 'professional',
              agent_prompt: store.agent_prompt || '',
              openai_api_key: store.openai_api_key || '',
              openai_model: store.openai_model || 'gpt-4o-mini',
              agent_context_window: store.agent_context_window ?? 15,
              agent_debounce_seconds: store.agent_debounce_seconds ?? 3,
              agent_cooldown_minutes: store.agent_cooldown_minutes ?? 30,
              agent_rate_limit: store.agent_rate_limit ?? 20,
              notification_phone: store.notification_phone || '',
              agent_max_message_chars: chars,
              agent_typing_speed_ms: store.agent_typing_speed_ms ?? 20,
              agent_image_prompt: store.agent_image_prompt || '',
              agent_end_prompt: store.agent_end_prompt || '',
              agent_stop_on_end: store.agent_stop_on_end ?? true,
            }
            setForm(loaded)
          }
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function handleResetPrompt() {
    const first = window.confirm('Tem certeza que deseja redefinir o prompt para o modelo padrão?')
    if (!first) return
    const second = window.confirm('Esta ação vai apagar o prompt atual. Confirma?')
    if (!second) return
    setForm(f => ({ ...f, agent_prompt: buildAgentPrompt(storeName) }))
    toast.info('Prompt redefinido para o modelo padrão. Salve para confirmar.')
  }

  useAutoSave(loading ? null : form, {
    onSave: async (currentForm) => {
      if (!currentForm) return
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentForm),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? 'Erro ao salvar.')
        throw new Error('save failed')
      }
    },
  })

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <Loader2 size={20} className="animate-spin text-muted-foreground" />
    </div>
  )

  return (
    <div className="max-w-2xl space-y-5">

      {/* Toggle principal — sempre visível */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: form.agent_active ? 'var(--ds-primary-50)' : '#F1F5F9' }}>
              <Bot size={20} style={{ color: form.agent_active ? 'var(--ds-primary-600)' : '#94A3B8' }} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900">Agente de IA</p>
              <p className="text-xs text-muted-foreground">
                {form.agent_active ? 'Respondendo no WhatsApp' : 'Desativado — clientes não recebem respostas automáticas'}
              </p>
            </div>
          </div>
          <Switch
            checked={form.agent_active}
            onCheckedChange={v => setForm(f => ({ ...f, agent_active: v }))}
          />
        </div>
      </div>

      <Tabs defaultValue="settings" className="w-full">
        <TabsList className="grid w-full grid-cols-6 mb-4">
          <TabsTrigger value="settings" className="gap-1.5 text-xs">
            <Settings size={13} />Personalidade
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="gap-1.5 text-xs">
            <Smartphone size={13} />WhatsApp
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-1.5 text-xs">
            <BookOpen size={13} />Conhecimento
          </TabsTrigger>
          <TabsTrigger value="salespeople" className="gap-1.5 text-xs">
            <Users size={13} />Vendedores
          </TabsTrigger>
          <TabsTrigger value="followup" className="gap-1.5 text-xs">
            <Clock size={13} />Follow-up
          </TabsTrigger>
          <TabsTrigger value="hours" className="gap-1.5 text-xs">
            <Clock size={13} />Horários
          </TabsTrigger>
        </TabsList>

        {/* ── Tab: Personalidade ─────────────────────────────────────────── */}
        <TabsContent value="settings" className="outline-none space-y-4">
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
            <p className="text-sm font-medium text-slate-900">Personalidade</p>

            {/* Campos ocultos para enganar o heurístico de login do Chrome */}
            <input type="text" name="fake_user" autoComplete="username" aria-hidden="true" className="hidden" readOnly />
            <input type="password" name="fake_pass" autoComplete="new-password" aria-hidden="true" className="hidden" readOnly />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">Nome do agente</Label>
                <Input value={form.agent_name}
                  onChange={e => setForm(f => ({ ...f, agent_name: e.target.value }))}
                  className="h-10" placeholder="CarGrow" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">Tom de voz</Label>
                <Select value={form.agent_tone} onValueChange={v => setForm(f => ({ ...f, agent_tone: v ?? '' }))}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="professional">Profissional</SelectItem>
                    <SelectItem value="friendly">Amigável</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium text-slate-700">Instruções para o agente</Label>
                <button
                  type="button"
                  onClick={handleResetPrompt}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-slate-700 transition-colors"
                >
                  <RotateCcw size={11} />
                  Redefinir prompt
                </button>
              </div>
              <Textarea
                ref={promptTextareaRef}
                value={form.agent_prompt}
                onChange={e => setForm(f => ({ ...f, agent_prompt: e.target.value }))}
                placeholder="Você é um assistente de vendas especializado em veículos. Seja direto, responda sobre o estoque disponível e incentive a visita à loja..."
                rows={5} className="resize-none" />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Variáveis:</span>
                {PROMPT_VARIABLES.map(v => (
                  <button
                    key={v.token}
                    type="button"
                    onClick={() => insertPromptVariable(v.token)}
                    title={v.description}
                    className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-xs text-slate-700 font-mono transition-colors"
                  >
                    {v.token}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Descreva como o agente deve se comportar. As variáveis acima são substituídas automaticamente em cada conversa.</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">Instrução para imagens recebidas</Label>
              <Textarea value={form.agent_image_prompt}
                onChange={e => setForm(f => ({ ...f, agent_image_prompt: e.target.value }))}
                placeholder="O cliente enviou uma imagem. Descreva o que vê e responda de forma útil no contexto de venda de veículos."
                rows={2} className="resize-none" />
              <p className="text-xs text-muted-foreground">Instrução enviada ao agente quando o cliente mandar uma foto. Ex: "Identifique se é um veículo e informe o cliente que podemos ajudá-lo."</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-slate-700">O atendimento termina quando</Label>
              <Textarea value={form.agent_end_prompt}
                onChange={e => setForm(f => ({ ...f, agent_end_prompt: e.target.value }))}
                placeholder="Ex: o cliente confirmar interesse em visitar a loja, fechar negócio, ou pedir para ser contatado depois."
                rows={2} className="resize-none" />
              <p className="text-xs text-muted-foreground">Descreva a condição de encerramento. Ao detectar, o agente envia notificação com resumo da conversa.</p>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium text-slate-700">Pausar agente ao encerrar</p>
                <p className="text-xs text-muted-foreground">Quando a conversa for encerrada, o agente para de responder este cliente.</p>
              </div>
              <Switch
                checked={form.agent_stop_on_end}
                onCheckedChange={v => setForm(f => ({ ...f, agent_stop_on_end: v }))}
              />
            </div>
          </div>

          {/* API Key + Modelo */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound size={15} className="text-muted-foreground" />
              <p className="text-sm font-medium text-slate-900">OpenAI</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">API Key</Label>
                <div className="relative">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    value={form.openai_api_key}
                    onChange={e => setForm(f => ({ ...f, openai_api_key: e.target.value }))}
                    placeholder="sk-..."
                    autoComplete="new-password"
                    className="h-10 pr-10 font-mono text-sm"
                  />
                  <button type="button" onClick={() => setShowKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-700">
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">platform.openai.com → API keys</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">Modelo</Label>
                <Select value={form.openai_model} onValueChange={v => setForm(f => ({ ...f, openai_model: v ?? '' }))}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-4.1-mini" description="Rápido e econômico">GPT-4.1 Mini</SelectItem>
                    <SelectItem value="gpt-4o-mini" description="Rápido e econômico">GPT-4o Mini</SelectItem>
                    <SelectItem value="gpt-4o" description="Inteligente">GPT-4o</SelectItem>
                    <SelectItem value="gpt-4.1" description="Mais inteligente">GPT-4.1</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">Janela de contexto</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={form.agent_context_window}
                    onChange={e => setForm(f => ({ ...f, agent_context_window: Number(e.target.value) }))}
                    className="h-10 w-24"
                  />
                  <span className="text-sm text-muted-foreground">mensagens</span>
                </div>
                <p className="text-xs text-muted-foreground">Mensagens anteriores que o agente lê para ter contexto.</p>
              </div>
            </div>
          </div>

          {/* Comportamento */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
            <p className="text-sm font-medium text-slate-900">Comportamento</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">Delay de acúmulo (debounce)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={60}
                    value={form.agent_debounce_seconds}
                    onChange={e => setForm(f => ({ ...f, agent_debounce_seconds: Number(e.target.value) }))}
                    className="h-10 w-24"
                  />
                  <span className="text-sm text-muted-foreground">segundos</span>
                </div>
                <p className="text-xs text-muted-foreground">Tempo que o agente aguarda para acumular mensagens antes de responder.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">Tamanho por mensagem</Label>
                <Select
                  value={msgSizeMode}
                  onValueChange={(v) => {
                    const mode = v as 'small' | 'medium' | 'large' | 'custom'
                    setMsgSizeMode(mode)
                    if (mode === 'small') setForm(f => ({ ...f, agent_max_message_chars: 150 }))
                    else if (mode === 'medium') setForm(f => ({ ...f, agent_max_message_chars: 300 }))
                    else if (mode === 'large') setForm(f => ({ ...f, agent_max_message_chars: 500 }))
                  }}
                >
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Pequena (~150 caracteres)</SelectItem>
                    <SelectItem value="medium">Média (~300 caracteres)</SelectItem>
                    <SelectItem value="large">Grande (~500 caracteres)</SelectItem>
                    <SelectItem value="custom">Personalizada</SelectItem>
                  </SelectContent>
                </Select>
                {msgSizeMode === 'custom' && (
                  <div className="flex items-center gap-2 mt-2">
                    <Input
                      type="number"
                      min={80}
                      max={1000}
                      value={form.agent_max_message_chars}
                      onChange={e => setForm(f => ({ ...f, agent_max_message_chars: Number(e.target.value) }))}
                      className="h-10 w-24"
                    />
                    <span className="text-sm text-muted-foreground">caracteres</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Mensagens longas são quebradas em partes para parecer mais humano.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">Velocidade de digitação</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={5}
                    max={100}
                    value={form.agent_typing_speed_ms}
                    onChange={e => setForm(f => ({ ...f, agent_typing_speed_ms: Number(e.target.value) }))}
                    className="h-10 w-24"
                  />
                  <span className="text-sm text-muted-foreground">ms/caractere</span>
                </div>
                <p className="text-xs text-muted-foreground">Tempo de digitação por caractere antes de enviar cada mensagem. Padrão: 20ms.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">Cooldown após mensagem humana</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={form.agent_cooldown_minutes}
                    onChange={e => setForm(f => ({ ...f, agent_cooldown_minutes: Number(e.target.value) }))}
                    className="h-10 w-24"
                  />
                  <span className="text-sm text-muted-foreground">minutos</span>
                </div>
                <p className="text-xs text-muted-foreground">O bot fica em silêncio por este período após uma mensagem enviada pelo atendente humano.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">Limite de mensagens por hora</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={form.agent_rate_limit}
                    onChange={e => setForm(f => ({ ...f, agent_rate_limit: Number(e.target.value) }))}
                    className="h-10 w-24"
                  />
                  <span className="text-sm text-muted-foreground">mensagens/hora por lead</span>
                </div>
                <p className="text-xs text-muted-foreground">Se um lead ultrapassar esse limite, o agente é pausado automaticamente e você recebe um aviso. Útil para evitar loops infinitos.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-slate-700">Número do admin (erros do sistema)</Label>
                <Input
                  type="tel"
                  value={form.notification_phone}
                  onChange={e => setForm(f => ({ ...f, notification_phone: e.target.value }))}
                  placeholder="5511999990000"
                  className="h-10"
                />
                <p className="text-xs text-muted-foreground">Recebe avisos de problemas técnicos (chave OpenAI inválida, rate limit). Notificações de leads vão para os vendedores cadastrados na aba Vendedores. Formato: DDI + DDD + número.</p>
              </div>
            </div>
          </div>

        </TabsContent>

        {/* ── Tab: WhatsApp ──────────────────────────────────────────────── */}
        <TabsContent value="whatsapp" className="outline-none space-y-4">
          <WhatsAppConnect storeId={storeId} />
          <WhatsAppLabels storeId={storeId} />
        </TabsContent>

        {/* ── Tab: Conhecimento ──────────────────────────────────────────── */}
        <TabsContent value="knowledge" className="outline-none">
          <KnowledgeEditor storeId={storeId} />
        </TabsContent>

        {/* ── Tab: Vendedores ────────────────────────────────────────────── */}
        <TabsContent value="salespeople" className="outline-none space-y-4">
          <Salespeople storeId={storeId} />
          <SummaryFieldsEditor />
        </TabsContent>

        {/* ── Tab: Follow-up ─────────────────────────────────────────────── */}
        <TabsContent value="followup" className="outline-none">
          <FollowUpConfig
            storeId={storeId}
            initialEnabled={followUpEnabled}
            initialConfig={followUpConfig}
          />
        </TabsContent>

        {/* ── Tab: Horários ──────────────────────────────────────────────── */}
        <TabsContent value="hours" className="outline-none">
          <AgentHours storeId={storeId} initialHours={agentHours} />
        </TabsContent>
      </Tabs>

    </div>
  )
}
