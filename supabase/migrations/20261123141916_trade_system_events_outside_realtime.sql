BEGIN;

-- System instructions/events are persisted separately from user chat messages.
-- This table must not be a member of the Supabase Realtime publication.
CREATE TABLE IF NOT EXISTS public.trade_system_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  sender_username text NOT NULL DEFAULT 'Paxones System',
  type text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trade_system_events_type_length_check CHECK (length(type) BETWEEN 1 AND 80),
  CONSTRAINT trade_system_events_message_length_check CHECK (length(message) BETWEEN 1 AND 12000),
  CONSTRAINT trade_system_events_dedupe_length_check CHECK (length(dedupe_key) BETWEEN 1 AND 200),
  CONSTRAINT trade_system_events_trade_dedupe_key UNIQUE (trade_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS trade_system_events_trade_created_idx
  ON public.trade_system_events (trade_id, created_at ASC);

ALTER TABLE public.trade_system_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trade_system_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trade_system_events TO service_role;

DO $publication$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'trade_system_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.trade_system_events;
  END IF;
END;
$publication$;

COMMIT;
