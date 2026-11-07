-- Restore durable, idempotent Didit webhook event claims and atomic KYC updates.
-- Forward repair for the current webhook handler. Event state is private and
-- all event access runs through postgres-owned SECURITY DEFINER RPCs.
BEGIN;

-- The live table predates the columns expected by the current webhook handler.
ALTER TABLE public.kyc_verifications
  ADD COLUMN IF NOT EXISTS vendor_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS decision JSONB NOT NULL DEFAULT '{}'::jsonb;

-- The current webhook records these provider lifecycle states. Keep the enum
-- explicit rather than silently coercing them to unrelated states.
ALTER TYPE public.kyc_status_enum ADD VALUE IF NOT EXISTS 'RESUBMIT_REQUIRED';
ALTER TYPE public.kyc_status_enum ADD VALUE IF NOT EXISTS 'ABANDONED';

-- Claiming is separate from applying the profile decision so simultaneous
-- delivery of one provider event cannot execute the handler concurrently.
-- A lease is recoverable after expiry; failed handlers can release immediately.
CREATE TABLE IF NOT EXISTS public.kyc_webhook_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROCESSING'
    CHECK (status IN ('PROCESSING', 'PROCESSED')),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  CONSTRAINT kyc_webhook_events_session_event_key UNIQUE (session_id, event_key),
  CONSTRAINT kyc_webhook_events_digest_check
    CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT kyc_webhook_events_lease_check
    CHECK (
      (status = 'PROCESSING' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR
      (status = 'PROCESSED' AND lease_token IS NULL AND lease_expires_at IS NULL AND processed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_kyc_webhook_events_processed_at
  ON public.kyc_webhook_events (processed_at)
  WHERE status = 'PROCESSED';

ALTER TABLE public.kyc_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kyc_webhook_events FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
-- Direct table access is intentionally denied; all event reads/writes use postgres-owned SECURITY DEFINER RPCs.

CREATE OR REPLACE FUNCTION public.claim_didit_webhook_event(
  p_session_id TEXT,
  p_event_key TEXT,
  p_payload_digest TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing public.kyc_webhook_events%ROWTYPE;
  v_lease_token UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted server execution required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_session_id IS NULL OR BTRIM(p_session_id) = '' OR LENGTH(p_session_id) > 512
     OR p_event_key IS NULL OR BTRIM(p_event_key) = '' OR LENGTH(p_event_key) > 320
     OR p_payload_digest IS NULL OR p_payload_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid Didit webhook event identity.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('didit-webhook:' || p_session_id || ':' || p_event_key, 0)
  );

  SELECT *
    INTO v_existing
    FROM public.kyc_webhook_events
   WHERE session_id = p_session_id
     AND event_key = p_event_key
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.payload_digest <> p_payload_digest THEN
      RETURN jsonb_build_object('status', 'conflict');
    END IF;

    IF v_existing.status = 'PROCESSED' THEN
      RETURN jsonb_build_object('status', 'duplicate');
    END IF;

    IF v_existing.lease_expires_at > NOW() THEN
      RETURN jsonb_build_object('status', 'busy');
    END IF;
  END IF;

  v_lease_token := gen_random_uuid();

  IF v_existing.id IS NULL THEN
    INSERT INTO public.kyc_webhook_events (
      session_id, event_key, payload_digest, status,
      lease_token, lease_expires_at, first_seen_at, updated_at
    )
    VALUES (
      p_session_id, p_event_key, p_payload_digest, 'PROCESSING',
      v_lease_token, NOW() + INTERVAL '2 minutes', NOW(), NOW()
    );
  ELSE
    UPDATE public.kyc_webhook_events
       SET status = 'PROCESSING',
           lease_token = v_lease_token,
           lease_expires_at = NOW() + INTERVAL '2 minutes',
           updated_at = NOW(),
           processed_at = NULL
     WHERE id = v_existing.id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'lease_token', v_lease_token
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_didit_webhook_event(
  p_session_id TEXT,
  p_event_key TEXT,
  p_payload_digest TEXT,
  p_lease_token UUID,
  p_success BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted server execution required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_session_id IS NULL OR p_event_key IS NULL
     OR p_payload_digest IS NULL OR p_lease_token IS NULL
     OR p_success IS NULL THEN
    RAISE EXCEPTION 'Invalid Didit webhook lease completion request.'
      USING ERRCODE = '22023';
  END IF;

  IF p_success THEN
    UPDATE public.kyc_webhook_events
       SET status = 'PROCESSED',
           lease_token = NULL,
           lease_expires_at = NULL,
           processed_at = NOW(),
           updated_at = NOW()
     WHERE session_id = p_session_id
       AND event_key = p_event_key
       AND payload_digest = p_payload_digest
       AND lease_token = p_lease_token
       AND status = 'PROCESSING';
  ELSE
    DELETE FROM public.kyc_webhook_events
     WHERE session_id = p_session_id
       AND event_key = p_event_key
       AND payload_digest = p_payload_digest
       AND lease_token = p_lease_token
       AND status = 'PROCESSING';
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_didit_webhook_event(TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.finish_didit_webhook_event(TEXT, TEXT, TEXT, UUID, BOOLEAN)
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.claim_didit_webhook_event(TEXT, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_didit_webhook_event(TEXT, TEXT, TEXT, UUID, BOOLEAN)
  TO service_role;

COMMENT ON TABLE public.kyc_webhook_events IS
  'Service-only idempotency and lease state for verified Didit webhook deliveries. Contains payload digests, not raw identity payloads.';

-- Apply profile + verification state and finalize the event lease atomically.
-- Every state-changing KYC webhook branch must use this RPC instead of separate REST writes.
CREATE OR REPLACE FUNCTION public.apply_didit_webhook_state(
  p_user_id UUID,
  p_session_id TEXT,
  p_event_key TEXT,
  p_payload_digest TEXT,
  p_lease_token UUID,
  p_profile_patch JSONB,
  p_verification_status public.kyc_status_enum,
  p_decision JSONB,
  p_vendor_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile_patch public.profiles%ROWTYPE;
  v_rows INTEGER;
  v_event_id BIGINT;
  v_kyc_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted server execution required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL OR p_session_id IS NULL OR BTRIM(p_session_id) = ''
     OR p_event_key IS NULL OR BTRIM(p_event_key) = ''
     OR p_payload_digest IS NULL OR p_payload_digest !~ '^[0-9a-f]{64}$'
     OR p_lease_token IS NULL OR p_verification_status IS NULL
     OR p_profile_patch IS NULL OR jsonb_typeof(p_profile_patch) <> 'object'
     OR p_decision IS NULL OR jsonb_typeof(p_decision) <> 'object'
     OR p_vendor_data IS NULL OR jsonb_typeof(p_vendor_data) <> 'object' THEN
    RAISE EXCEPTION 'Invalid Didit state application request.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_object_keys(p_profile_patch) AS supplied(key)
     WHERE supplied.key NOT IN (
       'kyc_status', 'is_banned', 'status', 'is_suspended',
       'is_kyc_locked', 'is_verified', 'id_verified',
       'kyc_retry_count', 'kyc_attempts', 'kyc_last_attempt_at',
       'kyc_approved_at', 'suspension_reason', 'full_name',
       'date_of_birth', 'dob', 'id_document_number', 'country',
       'is_country_locked', 'address', 'address_street',
       'is_address_locked', 'updated_at'
     )
  ) THEN
    RAISE EXCEPTION 'KYC profile patch contains an unsupported field.'
      USING ERRCODE = '22023';
  END IF;

  -- The event's lease token is the database fencing authority. A stale worker
  -- cannot write after a newer delivery has reclaimed the lease.
  SELECT id
    INTO v_event_id
    FROM public.kyc_webhook_events
   WHERE session_id = p_session_id
     AND event_key = p_event_key
     AND payload_digest = p_payload_digest
     AND lease_token = p_lease_token
     AND status = 'PROCESSING'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Didit webhook event lease was lost or already finalized.'
      USING ERRCODE = '40001';
  END IF;

  -- Lock and re-validate the active profile/session binding before any mutation.
  PERFORM 1
    FROM public.profiles AS p
   WHERE p.id = p_user_id
     AND (p.didit_session_id = p_session_id OR p.kyc_vendor_session_id = p_session_id)
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Didit session is no longer bound to the expected profile.'
      USING ERRCODE = '42501';
  END IF;

  SELECT id
    INTO v_kyc_id
    FROM public.kyc_verifications
   WHERE session_id = p_session_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Didit verification row is missing or belongs to another user.'
      USING ERRCODE = '42501';
  END IF;

  v_profile_patch := jsonb_populate_record(NULL::public.profiles, p_profile_patch);

  UPDATE public.profiles AS p
     SET kyc_status = COALESCE(v_profile_patch.kyc_status, p.kyc_status),
         is_banned = COALESCE(v_profile_patch.is_banned, p.is_banned),
         status = COALESCE(v_profile_patch.status, p.status),
         is_suspended = COALESCE(v_profile_patch.is_suspended, p.is_suspended),
         is_kyc_locked = COALESCE(v_profile_patch.is_kyc_locked, p.is_kyc_locked),
         is_verified = COALESCE(v_profile_patch.is_verified, p.is_verified),
         id_verified = COALESCE(v_profile_patch.id_verified, p.id_verified),
         kyc_retry_count = COALESCE(v_profile_patch.kyc_retry_count, p.kyc_retry_count),
         kyc_attempts = COALESCE(v_profile_patch.kyc_attempts, p.kyc_attempts),
         kyc_last_attempt_at = COALESCE(v_profile_patch.kyc_last_attempt_at, p.kyc_last_attempt_at),
         kyc_approved_at = COALESCE(v_profile_patch.kyc_approved_at, p.kyc_approved_at),
         suspension_reason = COALESCE(v_profile_patch.suspension_reason, p.suspension_reason),
         full_name = COALESCE(v_profile_patch.full_name, p.full_name),
         date_of_birth = COALESCE(v_profile_patch.date_of_birth, p.date_of_birth),
         dob = COALESCE(v_profile_patch.dob, p.dob),
         id_document_number = COALESCE(v_profile_patch.id_document_number, p.id_document_number),
         country = COALESCE(v_profile_patch.country, p.country),
         is_country_locked = COALESCE(v_profile_patch.is_country_locked, p.is_country_locked),
         address = COALESCE(v_profile_patch.address, p.address),
         address_street = COALESCE(v_profile_patch.address_street, p.address_street),
         is_address_locked = COALESCE(v_profile_patch.is_address_locked, p.is_address_locked),
         updated_at = COALESCE(v_profile_patch.updated_at, NOW())
   WHERE p.id = p_user_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'KYC profile state update did not affect exactly one row.'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.kyc_verifications
     SET status = p_verification_status,
         decision = p_decision,
         vendor_data = p_vendor_data,
         updated_at = NOW()
   WHERE id = v_kyc_id
     AND session_id = p_session_id
     AND user_id = p_user_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'KYC verification state update did not affect exactly one row.'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.kyc_webhook_events
     SET status = 'PROCESSED',
         lease_token = NULL,
         lease_expires_at = NULL,
         processed_at = NOW(),
         updated_at = NOW()
   WHERE id = v_event_id
     AND lease_token = p_lease_token
     AND status = 'PROCESSING';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'KYC webhook event could not be finalized atomically.'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', p_verification_status::TEXT,
    'processed', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_didit_webhook_state(
  UUID, TEXT, TEXT, TEXT, UUID, JSONB, public.kyc_status_enum, JSONB, JSONB
) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.apply_didit_webhook_state(
  UUID, TEXT, TEXT, TEXT, UUID, JSONB, public.kyc_status_enum, JSONB, JSONB
) TO service_role;

-- Identity-sequence privileges are managed independently from table ACLs.
DO $sequence_acl$
DECLARE
  v_sequence REGCLASS;
BEGIN
  v_sequence := pg_get_serial_sequence('public.kyc_webhook_events', 'id')::regclass;
  IF v_sequence IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin', v_sequence);
    -- Sequence access is performed by the postgres-owned event-claim function.
  END IF;
END;
$sequence_acl$;

NOTIFY pgrst, 'reload schema';

COMMIT;
