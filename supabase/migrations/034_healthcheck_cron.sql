-- ============================================================
-- Healthcheck periódico via pg_cron
-- A cada 15 min, chama POST /internal/healthcheck do agente.
-- O próprio agente roda os 5 checks e, se algum falhar, posta
-- direto no n8n com payload rico. pg_cron aqui é só o disparador.
-- ============================================================

-- ── Função que o pg_cron chama ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_healthcheck_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_secret TEXT;
  v_url    TEXT := 'https://api.cargrow.com.br/internal/healthcheck';
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'cron_secret'
   LIMIT 1;

  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE NOTICE 'cron_secret não encontrado no vault — pulando healthcheck';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
END;
$$;

COMMENT ON FUNCTION public.trigger_healthcheck_cron() IS
  'Disparada por pg_cron a cada 15 min. Faz POST para /internal/healthcheck do agente, que envia alerta para n8n se algo falhar.';

-- ── Schedule: a cada 15 minutos ──────────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('healthcheck-every-15min');
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'healthcheck-every-15min',
  '*/15 * * * *',
  $$SELECT public.trigger_healthcheck_cron()$$
);
