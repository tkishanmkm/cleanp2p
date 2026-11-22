-- Keep every HD wallet derivation index on one monotonic sequence.
-- The previous claim RPC used wallet_index_seq - 1 while auth signup used
-- user_wallet_index_seq directly, allowing the two paths to drift.
BEGIN;

DO $wallet_index_sequence_guard$
DECLARE
  v_user_sequence_last BIGINT;
  v_legacy_sequence_last BIGINT;
  v_max_profile_index BIGINT;
  v_target_index BIGINT;
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.user_wallet_index_seq') IS NULL
     OR to_regclass('public.wallet_index_seq') IS NULL THEN
    RAISE EXCEPTION 'Profiles or an expected wallet-index sequence is missing; refusing allocator reconciliation.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (wallet_index)'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indrelid = 'public.profiles'::regclass
      AND indisunique
      AND indpred IS NULL
      AND pg_get_indexdef(indexrelid) ILIKE '%(wallet_index)%'
  ) THEN
    RAISE EXCEPTION 'A full unique wallet_index constraint/index is required before allocation can be unified.';
  END IF;

  EXECUTE 'SELECT last_value FROM public.user_wallet_index_seq'
    INTO v_user_sequence_last;
  EXECUTE 'SELECT last_value FROM public.wallet_index_seq'
    INTO v_legacy_sequence_last;
  SELECT COALESCE(MAX(wallet_index), 0)
    INTO v_max_profile_index
  FROM public.profiles;

  -- claim_next_wallet_index() historically returned nextval(wallet_index_seq)-1.
  -- Preserve any value it could already have handed out while switching both
  -- signup and fallback allocation to user_wallet_index_seq.
  v_target_index := GREATEST(
    COALESCE(v_user_sequence_last, 0),
    COALESCE(v_legacy_sequence_last, 1) - 1,
    COALESCE(v_max_profile_index, 0)
  );

  IF v_target_index < 0 OR v_target_index >= 2147483647 THEN
    RAISE EXCEPTION 'Wallet index sequence reached the supported integer boundary; manual migration planning is required.';
  END IF;

  -- ALTER SEQUENCE RESTART is transactional; setval() is not. This ensures
  -- a failed/rolled-back migration cannot still consume or advance indexes.
  EXECUTE format(
    'ALTER SEQUENCE public.user_wallet_index_seq RESTART WITH %s',
    v_target_index + 1
  );
END;
$wallet_index_sequence_guard$;

-- Auth signup and any database-triggered fallback now consume the same sequence.
CREATE OR REPLACE FUNCTION public.claim_next_wallet_index()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN nextval('public.user_wallet_index_seq'::regclass)::INTEGER;
END;
$function$;

ALTER FUNCTION public.claim_next_wallet_index() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.claim_next_wallet_index()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_wallet_index() TO service_role;

-- A full-admin-only API invokes this atomic batch operation. Rows are locked
-- before allocating values, concurrent calls skip already-claimed rows, and
-- the unique wallet_index constraint remains the final collision guard.
CREATE OR REPLACE FUNCTION public.assign_missing_profile_wallet_indexes()
RETURNS TABLE(assigned_count BIGINT, last_wallet_index INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role TEXT;
BEGIN
  v_role := COALESCE(auth.role(), current_setting('role', true), '');

  IF v_role <> 'service_role' THEN
    RAISE EXCEPTION 'Service-role execution is required to assign wallet indexes.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH locked_profiles AS MATERIALIZED (
    SELECT p.id
    FROM public.profiles AS p
    WHERE p.wallet_index IS NULL
    ORDER BY p.created_at NULLS FIRST, p.id
    FOR UPDATE SKIP LOCKED
  ),
  allocated AS MATERIALIZED (
    SELECT
      lp.id,
      nextval('public.user_wallet_index_seq'::regclass)::INTEGER AS wallet_index
    FROM locked_profiles AS lp
  ),
  updated AS (
    UPDATE public.profiles AS p
       SET wallet_index = a.wallet_index
      FROM allocated AS a
     WHERE p.id = a.id
       AND p.wallet_index IS NULL
    RETURNING p.wallet_index
  )
  SELECT count(*)::BIGINT, max(u.wallet_index)::INTEGER
  FROM updated AS u;
END;
$function$;

ALTER FUNCTION public.assign_missing_profile_wallet_indexes() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.assign_missing_profile_wallet_indexes()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_missing_profile_wallet_indexes() TO service_role;

COMMIT;
