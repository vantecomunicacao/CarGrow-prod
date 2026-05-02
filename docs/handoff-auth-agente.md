# Migração de Autenticação no Agente Express — Handoff

## 1. O que foi feito (no código, já mergeable)

O serviço Express em `agente/src/server.ts` rodava com `cors()` aberto e zero autenticação. Adicionei autenticação em camadas, em **shadow mode** por padrão (loga rejeições mas não bloqueia ainda — para validar em prod sem quebrar nada).

### Mudanças principais

| Vetor | Solução |
|---|---|
| Browser admin → Express | `Authorization: Bearer ${supabase_access_token}` validado via `supabase.auth.getUser(token)` com cache 60s. `store_id` vem **do JWT**, não da query (anti-IDOR cross-tenant). |
| Evolution API → `/webhook` | Path agora é `/webhook/:secret`, validado com `crypto.timingSafeEqual`. Rota legacy `/webhook` mantida 1 release com `console.warn`. |
| SSE `/logs/stream` | `EventSource` não envia headers, então cliente faz `POST /auth/sse-ticket` (Bearer) → recebe ticket HMAC-SHA256 (TTL 60s) → passa em `?ticket=`. |
| CORS | Whitelist via `ALLOWED_ORIGINS` (vírgula-separado). Requests sem origin (server-side, webhook) passam — auth por rota cuida. |
| Rate limit | `express-rate-limit`: 60/min IP nas admin, 600/min no webhook, sem limit em `/health`. |
| Headers | `helmet()` aplicado globalmente. |
| Cleanup | Removida rota dead `/leads/:id/ai`. |

### Arquivos novos
- `agente/src/auth/jwtCache.ts` — cache token→user com TTL 60s, LRU 1000
- `agente/src/auth/sseTicket.ts` — sign/verify HMAC-SHA256 de tickets
- `agente/src/auth/middleware.ts` — `requireAuth`, `requireWebhookSecret`, `requireSseTicket`
- `lib/agent/fetchAgent.ts` — wrapper client que injeta o Bearer + helpers SSE

### Arquivos modificados
- `agente/src/server.ts` — middlewares aplicados, `/webhook/:secret`, `/auth/sse-ticket`, `requireAuth` em todas rotas admin
- `agente/package.json` — adiciona `helmet@^8`, `express-rate-limit@^7`
- 3 components React em `app/admin/(protected)/` — usam `fetchAgent`

### Validações já passaram
- `tsc --noEmit` (raiz + agente): ✅
- `npm run build` agente: ✅
- `jest`: 89/90 passing (1 pre-existing skip)

---

## 2. Instruções operacionais para a IA com MCP

### CONTEXTO QUE A OUTRA IA PRECISA SABER

- Projeto Coolify: **VT-auto**, UUID `bgco4s4k4004gco44cco8o4o`. **NUNCA tocar em outros projetos.**
- O agente Express roda como serviço separado nesse projeto Coolify. Next.js (frontend) roda em outro deploy.
- Supabase é o auth provider. JWT já tem custom claims `store_id`, `role`, `is_master` (configurados via Auth Hook). O middleware novo lê esses claims.
- O webhook do Evolution API hoje aponta para `${PUBLIC_URL}/webhook` (sem secret). Após esta migração, deve apontar para `${PUBLIC_URL}/webhook/${EVOLUTION_WEBHOOK_SECRET}`.

---

### TAREFA A — Verificar custom claims no Supabase

**Objetivo:** confirmar que o Auth Hook do Supabase está populando `store_id`, `role`, `is_master` no JWT. Sem isso, o middleware rejeita todos os usuários.

**Passos:**

1. Listar Auth Hooks ativos no projeto Supabase. Procurar por um `custom_access_token_hook` (Postgres function ou edge function).
2. Se existe, inspecionar o código e confirmar que injeta as 3 claims no payload retornado.
3. **Validação prática:** pegar um usuário de teste (qualquer um da tabela `auth.users`), gerar um access_token via API admin, decodificar o payload (parte do meio do JWT, base64url) e confirmar que tem `store_id`, `role`, `is_master`.

**Se NÃO houver hook configurado**, pare aqui e reporte. O middleware vai rejeitar 100% dos requests quando flipar.

---

### TAREFA B — Gerar secrets e configurar env vars no Coolify

**Objetivo:** configurar as 4 env vars novas no projeto VT-auto.

**Passos:**

1. Gerar 2 secrets aleatórios (256 bits cada, hex). Métodos:
   - Pode usar a função Supabase `gen_random_bytes(32)::text` via SQL e converter para hex
   - Ou qualquer fonte de aleatoriedade segura — o requisito é 64 caracteres hex
2. Anote os 2 valores gerados — vai precisar deles na TAREFA C.
3. No Coolify, no projeto VT-auto, adicionar as seguintes env vars **na aplicação do agente** (não em outras apps do projeto):

```
EVOLUTION_WEBHOOK_SECRET=<primeiro_secret_64_hex>
SSE_TICKET_SECRET=<segundo_secret_64_hex>
ALLOWED_ORIGINS=https://app.cargrow.com.br,https://master.cargrow.com.br
AUTH_ENABLED=false
```

4. **NÃO redeploy ainda.** O redeploy precisa acontecer DEPOIS da TAREFA C (pra evitar janela onde o webhook fica quebrado).

**Verificação:** após salvar, listar env vars da aplicação e confirmar que as 4 estão presentes com valores não-vazios.

---

### TAREFA C — Atualizar webhook na Evolution API

**Objetivo:** apontar o webhook da Evolution API para a nova URL com secret no path.

**Contexto:** o agente já tem código (`buildWebhookUrl()` em `server.ts`) que registra o webhook automaticamente quando um usuário clica "Conectar WhatsApp". Mas instâncias **já conectadas** continuam apontando para a URL antiga até alguém clicar de novo. Precisamos atualizar manualmente as instâncias existentes.

**Passos:**

1. Listar todas as instâncias ativas na Evolution API (endpoint `/instance/fetchInstances` da Evolution).
2. Para cada instância, atualizar o webhook (endpoint `POST /webhook/set/<instance_name>` da Evolution) com:
   ```json
   {
     "webhook": {
       "enabled": true,
       "url": "<PUBLIC_URL>/webhook/<EVOLUTION_WEBHOOK_SECRET>",
       "webhookByEvents": false,
       "webhookBase64": false,
       "events": ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
     }
   }
   ```
   onde:
   - `<PUBLIC_URL>` = valor da env var `PUBLIC_URL` já configurada no Coolify do projeto VT-auto
   - `<EVOLUTION_WEBHOOK_SECRET>` = o primeiro secret gerado na TAREFA B
3. Reportar quantas instâncias foram atualizadas.

---

### TAREFA D — Redeploy do agente

**Objetivo:** publicar o código novo + as env vars.

**Passos:**

1. Fazer deploy do projeto VT-auto no Coolify (apenas a aplicação do agente, não toda a stack se houver outras).
2. Aguardar o deploy completar (status running, healthcheck passando).
3. Verificar `GET /health` retornando 200.
4. Verificar nos logs do container que o serviço subiu sem erro: procurar pela linha `[agente] Serviço rodando em http://localhost:3001`.

---

### TAREFA E — Validação em shadow mode

**Objetivo:** confirmar que a auth está funcionando como esperado SEM bloquear ninguém.

**Passos:**

1. Aguardar 30 minutos a partir do redeploy para acumular tráfego real.
2. Capturar logs do agente no Coolify, filtrar por `[auth-shadow]`.
3. **Cenário desejado:** zero ocorrências de `[auth-shadow] would-reject` para callers legítimos (mas pode ter ocorrências para callers maliciosos/scanners — esses são bons sinais).
4. Filtrar também por `[deprecated]` — a contagem deve cair para zero conforme as instâncias Evolution forem usando o novo path. Se persistir após 1h, alguma instância ainda está apontando para `/webhook` antigo — voltar à TAREFA C e identificar.
5. Aguardar **24 horas** com tráfego real antes da TAREFA F.

**Critério de avanço:**
- Zero `would-reject` de callers legítimos por 24h
- Zero `[deprecated]` por 24h
- Nenhum incidente reportado pelos donos de loja (knowledge não carrega, QR não aparece, logs não streamam)

---

### TAREFA F — Flip do auth (FAZER SÓ APÓS APROVAÇÃO HUMANA)

**Objetivo:** ligar a rejeição de fato.

**Passos:**

1. **Confirmar com o humano** que TAREFA E ficou limpa por 24h e que ele aprova o flip.
2. No Coolify, alterar `AUTH_ENABLED` de `false` para `true`. Redeploy do agente.
3. Verificar nos primeiros 15 minutos: logs devem ter `401 unauthorized` apenas para requests sem token (scanners). Se houver 401 para callers legítimos, ROLLBACK imediato (TAREFA G).

---

### TAREFA G — Rollback (se algo der errado)

**Cenários:**
- Usuários legítimos recebendo 401 após flip → setar `AUTH_ENABLED=false`, redeploy. Investigar custom claims (TAREFA A).
- Webhook quebrado após TAREFA C → reverter URL na Evolution para `${PUBLIC_URL}/webhook` (sem secret). A rota legacy ainda existe e aceita.
- Erros gerais no agente após redeploy → rollback de deploy via Coolify (deploy anterior).

---

## 3. Critérios de sucesso final

- [ ] Custom claims do Supabase confirmados ativos (TAREFA A)
- [ ] 4 env vars novas configuradas no Coolify do projeto VT-auto (TAREFA B)
- [ ] 100% das instâncias Evolution apontando para `/webhook/:secret` (TAREFA C)
- [ ] Deploy do agente bem-sucedido com `AUTH_ENABLED=false` (TAREFA D)
- [ ] 24h de shadow mode sem `would-reject` legítimos (TAREFA E)
- [ ] Flip para `AUTH_ENABLED=true` aprovado e executado (TAREFA F)
- [ ] Após 1 release com `AUTH_ENABLED=true` estável, **avisar o humano** para remover a rota legacy `/webhook` em `agente/src/server.ts:189` (precisa edição de código, não é tarefa via MCP).
