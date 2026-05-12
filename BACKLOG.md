# Backlog técnico

Lista de pendências identificadas em auditorias. Cada item tem severidade, contexto e referência ao código.

> Última atualização: 2026-05-12

---

## Agente de conversação

### [média] Guarda no código contra repetição do marcador [FOTOS:]
O prompt instrui o modelo a não repetir `[FOTOS:marca:modelo]` quando o veículo já foi
apresentado, mas LLM é probabilístico e pode desobedecer. Defesa real: detectar no código
se aquele marcador já apareceu nas últimas N respostas do assistente e suprimir o disparo
de imagens.
- [agente/src/agent.ts](agente/src/agent.ts) (bloco de envio de fotos, ~linha 730)

### [média] Vision usa gpt-4o fixo em vez do openai_model da loja
A análise de imagem em `enqueueMedia` chama `gpt-4o` direto, ignorando `store.openai_model`.
`gpt-4o-mini` também tem vision e custa ~16× menos. A loja paga sem saber.
- [agente/src/agent.ts:218](agente/src/agent.ts#L218)

### [média] getStockContext sem cache
Cada mensagem busca até 200 veículos do banco e injeta no system prompt. Em conversas
longas multiplica tokens de input desnecessariamente. Cachear por `store_id` com TTL ~60s.
- [agente/src/vehicles.ts:142](agente/src/vehicles.ts#L142)

### [média] agent_conversations insert sem lead_id
O fluxo principal salva mensagens em `agent_conversations` sem preencher `lead_id`,
enquanto o fluxo de mídia não suportada em [server.ts:270-271](agente/src/server.ts#L270-L271)
preenche. Inconsistência que dificulta joins/queries.
- [agente/src/agent.ts:687-690](agente/src/agent.ts#L687-L690)

### [baixa] Catch silencioso na notificação de encerramento
Falha no `sendMessage` do resumo de encerramento ao vendedor não loga via `logStep`.
No fluxo de transbordo loga; aqui não. Vendedor pode não receber e ninguém saber.
- [agente/src/agent.ts:676](agente/src/agent.ts#L676)

---

## Como usar este arquivo

- Adicionar item: descrição curta + severidade + arquivo:linha
- Remover ao corrigir (não marcar como done — deletar a entrada)
- Revisar quando começar uma rodada de melhorias no agente
