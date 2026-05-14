# Backlog técnico

Lista de pendências identificadas em auditorias. Cada item tem severidade, contexto e referência ao código.

> Última atualização: 2026-05-14

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
