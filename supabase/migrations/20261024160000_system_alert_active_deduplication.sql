-- Deduplicate repeated active system alerts while allowing a new alert after resolution.
-- Existing rows are left intact; the partial unique index applies to keyed active alerts.
BEGIN;

ALTER TABLE public.system_alerts
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_system_alerts_active_dedupe_key
  ON public.system_alerts (dedupe_key)
  WHERE is_resolved = FALSE AND dedupe_key IS NOT NULL;

COMMIT;
