-- ── Pausa temporária por rate limit ──────────────────────────────────────────
-- Quando o lead estoura o rate limit, o agente pausa por uma janela definida
-- e auto-retoma quando ai_paused_until expira. Antes desta migration, a pausa
-- era permanente e só destravava com intervenção manual.

ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_ai_paused_reason_check;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_ai_paused_reason_check
    CHECK (ai_paused_reason IN ('transbordo', 'encerramento', 'manual', 'whatsapp_label', 'rate_limit'));

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS ai_paused_until TIMESTAMPTZ;

COMMENT ON COLUMN public.leads.ai_paused_until IS
  'Quando a pausa temporária (ex: rate_limit) expira. Após esse momento o agente reativa automaticamente.';
