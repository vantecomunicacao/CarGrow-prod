# Análise Técnica — CarGrow

> Data: 2026-04-13

## Nota Geral: **7.2 / 10**

Um SaaS de concessionárias bem arquitetado, com funcionalidades sofisticadas. Base sólida, mas com lacunas importantes para escalar com segurança.

---

## Pontuação por Categoria

| Área | Nota | Status |
|------|------|--------|
| Arquitetura | 8.0 | Excelente |
| Qualidade de Código | 7.0 | Bom |
| Segurança | 7.5 | Bom (1 risco crítico) |
| Performance | 6.5 | Regular |
| Testes | 4.0 | Fraco |
| Design de API | 8.0 | Excelente |
| DevOps / Deploy | 7.0 | Bom |
| Integração IA | 7.5 | Bom |

---

## Pontos Fortes

**1. Arquitetura multi-tenant profissional**
Roteamento por subdomínio via `proxy.ts` é elegante — cada loja tem seu próprio slug (`loja.dominio.com`), sem URLs duplicadas ou gambiarra.

**2. Segurança a nível de banco de dados**
RLS (Row Level Security) via Supabase está bem implementado. Vendedores só enxergam leads deles, donos enxergam tudo.

**3. TypeScript + Zod em tudo**
Tipagem forte end-to-end, validação com schemas Zod nas APIs críticas, tipos gerados do Supabase.

**4. Integração de IA sofisticada**
O agente WhatsApp vai além do básico:
- RAG com pgvector para base de conhecimento por loja
- Transcrição de áudio (Whisper)
- Visão de imagens (GPT-4o)
- Debounce de mensagens, follow-ups automáticos, horários de atendimento
- Humanização (simulate typing)

**5. Sistema de unsaved changes**
Hook `useUnsavedChanges` + banner de aviso é um padrão consistente e útil. Evita perda de dados acidental.

**6. API bem definida**
Endpoints RESTful consistentes, status codes corretos (201, 422, 429...), rate limiting no check-subdomain, whitelist de campos no PATCH de settings.

---

## Pontos Fracos

### Crítico

**1. Chaves de API armazenadas em texto puro**
`openai_api_key` fica em plain text na tabela `stores`. Se houver dump de banco, todas as chaves de todas as lojas vazam. Precisa de criptografia em repouso (AES-256 ou Vault).

**2. Zero testes no frontend**
Nenhum teste em `app/` ou `components/`. 70% do codebase sem cobertura. Um refactor quebra silenciosamente features de produção.

### Importante

**3. Follow-up via polling (setTimeout)**
O ciclo de follow-up roda a cada 5 minutos consultando o banco pra todas as lojas. Com 100+ lojas isso vira gargalo. Precisa de BullMQ ou pg_cron.

**4. Agente é single-process**
Estado de deduplicação (`Set` em memória) e debounce não sobrevivem a múltiplas instâncias. Escalar horizontalmente vai gerar mensagens duplicadas.

**5. Sem cache**
Nenhuma camada de cache para veículos, configurações de loja ou sessões de agente. Toda request bate no Supabase. Com volume, latência aumenta linearmente.

**6. Sem monitoramento de erros**
Nenhum Sentry, Datadog ou similar. Erros em produção só aparecem se alguém olhar os logs manualmente.

### Menor

- Sem documentação OpenAPI/Swagger das rotas
- Sem testes de integração nas API routes do Next.js
- Sem proteção contra prompt injection no agente
- Sem circuit breaker para falhas da OpenAI API

---

## Melhorias Sugeridas (por prioridade)

### Alta prioridade

1. **Criptografar `openai_api_key`** — AES-256 ou Supabase Vault
2. **Adicionar Sentry** — 1 linha de config, retorno imediato em produção
3. **Testes E2E com Playwright** — cobrir: login, criar veículo, lead, configurar agente
4. **Mover follow-up para pg_cron ou BullMQ** — escala corretamente

### Média prioridade

5. **Adicionar Redis (Upstash)** — cache de settings e veículos por loja (TTL 5min)
6. **Mover estado do agente para Redis** — deduplicação e debounce distribuídos
7. **Circuit breaker na OpenAI API** — fallback gracioso quando API fora
8. **Rate limiting por lead no agente** — evitar flood em loop

### Baixa prioridade

9. Documentar API com OpenAPI/Swagger
10. Adicionar métricas de performance (p95 latency por endpoint)
11. Validação de prompt injection básica no agente
12. Seed de banco para ambiente de desenvolvimento

---

## Resumo Executivo

É um sistema genuinamente bem construído para o que propõe. A arquitetura multi-tenant, o agente IA com RAG e a tipagem consistente são diferenciais reais. O risco maior não é arquitetural — é operacional: sem testes frontend e sem monitoramento, um bug em produção pode demorar horas pra ser detectado. As correções prioritárias (criptografia de chaves e Sentry) são de baixo esforço e alto impacto.
