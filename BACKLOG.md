# Backlog técnico

Lista de pendências identificadas em auditorias. Cada item tem severidade, contexto e referência ao código.

> Última atualização: 2026-05-14

---

## Segurança

### [ALTA] DELETE /api/team/[id] sem verificação de auth nem tenant

A rota [app/api/team/[id]/route.ts](app/api/team/[id]/route.ts) usa `createAdminClient()` (bypass RLS) e:

- NÃO chama `createClient().auth.getUser()` — não verifica se o caller está logado
- NÃO filtra o `member` pelo `store_id` da loja do caller — qualquer um pode passar um `id` de membro de outra loja

Como o middleware [middleware.ts:10-15](middleware.ts#L10-L15) ignora rotas `/api/*`, um usuário malicioso (ou anônimo) consegue desativar membros de qualquer loja chamando `DELETE /api/team/<id-de-vítima>`.

**Correção:** espelhar o padrão de `app/api/team/invite/route.ts` — chamar `createClient()`, validar user, buscar `store_users` filtrando por `(user_id, store_id-do-membro-alvo)` e exigir role `owner`. Adicionar testes de 401 e 403 (cross-tenant) ao remover este item.

---

## Lint / qualidade

### [média] 72 erros de ESLint pendentes

`npm run lint` reporta 72 errors e 52 warnings. A maioria são `@typescript-eslint/no-explicit-any` nos
specs do Playwright e `react/no-unescaped-entities` em formulários. Limpá-los abre caminho para
incluir `lint` como gate obrigatório no CI (hoje o CI só roda typecheck + testes do agente).

Arquivos com maior concentração:

- [e2e/leads.spec.ts](e2e/leads.spec.ts), [e2e/master.spec.ts](e2e/master.spec.ts),
  [e2e/settings.spec.ts](e2e/settings.spec.ts), [e2e/vehicles.spec.ts](e2e/vehicles.spec.ts) — `any` em helpers
- [components/admin/vehicles/VehicleForm.tsx](components/admin/vehicles/VehicleForm.tsx) — aspas não escapadas
- [scripts/fix-rls.mts](scripts/fix-rls.mts) — variáveis não usadas

---

## Como usar este arquivo

- Adicionar item: descrição curta + severidade + arquivo:linha
- Remover ao corrigir (não marcar como done — deletar a entrada)
- Revisar quando começar uma rodada de melhorias
