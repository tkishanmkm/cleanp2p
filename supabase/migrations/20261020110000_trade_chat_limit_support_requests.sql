-- Idempotency guard for support tickets created after a trader reaches the 100-message cap.
-- Local migration only; validate against a schema-matched disposable database before applying.
BEGIN;

CREATE TABLE IF NOT EXISTS public.trade_chat_limit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  support_ticket_id text,
  status text NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'submitted')),
  email_status text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trade_chat_limit_requests_one_per_user_trade UNIQUE (trade_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_chat_limit_requests_created_at
  ON public.trade_chat_limit_requests (created_at DESC);

ALTER TABLE public.trade_chat_limit_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trade_chat_limit_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trade_chat_limit_requests TO service_role;

COMMIT;
