-- Read-only catalog checks for the public profile privacy boundary.
DO $profile_projection_preflight$
DECLARE
  v_view_oid OID := to_regclass('public.public_profiles');
  v_view_owner TEXT;
  v_view_options TEXT[];
BEGIN
  IF v_view_oid IS NULL THEN
    RAISE EXCEPTION 'public.public_profiles is missing.';
  END IF;

  SELECT pg_get_userbyid(c.relowner), c.reloptions
    INTO v_view_owner, v_view_options
  FROM pg_class AS c
  WHERE c.oid = v_view_oid
    AND c.relkind = 'v';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'public.public_profiles must be a regular view.';
  END IF;

  IF v_view_owner <> 'postgres' THEN
    RAISE EXCEPTION 'public.public_profiles must be owned by postgres; found %.', v_view_owner;
  END IF;

  IF NOT COALESCE(v_view_options @> ARRAY['security_barrier=true'], FALSE) THEN
    RAISE EXCEPTION 'public.public_profiles must use security_barrier=true.';
  END IF;

  IF EXISTS (
    SELECT required.column_name
    FROM unnest(ARRAY[
      'id', 'username', 'display_name', 'avatar_url', 'photo_url', 'country',
      'country_code', 'created_at', 'is_online', 'is_verified',
      'completed_trades', 'total_completed_trades', 'trade_volume',
      'total_volume_usd', 'total_traded_usd', 'positive_feedback',
      'negative_feedback', 'feedback_score', 'avg_payment_time_mins',
      'avg_payment_minutes', 'avg_pay_time', 'avg_release_time_mins',
      'avg_release_minutes', 'avg_release_time', 'merchant_tier',
      'is_trading_eligible'
    ]) AS required(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'public_profiles'
        AND c.column_name = required.column_name
    )
  ) THEN
    RAISE EXCEPTION 'public.public_profiles is missing one or more required public projection columns.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'public_profiles'
      AND c.column_name = ANY (ARRAY[
        'email', 'full_name', 'name', 'role', 'is_admin', 'is_admin_account',
        'status', 'account_status', 'is_banned', 'is_suspended', 'is_restricted',
        'is_on_hold', 'is_emergency_frozen', 'is_minor_restricted',
        'ban_reason', 'suspension_reason', 'dob', 'date_of_birth',
        'address', 'address_street', 'address_city', 'address_postal_code',
        'kyc_status', 'kyc_vendor_session_id', 'didit_session_id',
        'kyc_documents_b2_key', 'id_document_number', 'security_question',
        'security_answer', 'security_answer_hash', 'totp_secret',
        'two_factor_secret', 'admin_2fa_secret', 'admin_2fa_recovery_hash',
        'evm_deposit_address', 'tron_deposit_address', 'btc_deposit_address',
        'ltc_deposit_address', 'merchant_deposit_usdt'
      ])
  ) THEN
    RAISE EXCEPTION 'public.public_profiles contains a private or restricted profile column.';
  END IF;

  IF has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR has_table_privilege('authenticated', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION 'profiles must not have table-level SELECT grants to anon/authenticated.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.column_privileges AS cp
    WHERE cp.table_schema = 'public'
      AND cp.table_name = 'profiles'
      AND cp.privilege_type = 'SELECT'
      AND cp.grantee IN ('PUBLIC', 'anon')
  ) THEN
    RAISE EXCEPTION 'PUBLIC/anon still has column-level SELECT grants on profiles.';
  END IF;

  IF has_column_privilege('authenticated', 'public.profiles', 'totp_secret', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'two_factor_secret', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'admin_2fa_secret', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'admin_2fa_recovery_hash', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'security_answer', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'security_answer_hash', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'id_document_number', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'kyc_documents_b2_key', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'kyc_vendor_session_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'didit_session_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'evm_deposit_address', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'tron_deposit_address', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'btc_deposit_address', 'SELECT')
     OR has_column_privilege('authenticated', 'public.profiles', 'ltc_deposit_address', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated still has SELECT on a restricted profile secret/identifier column.';
  END IF;

  IF NOT has_table_privilege('anon', 'public.public_profiles', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.public_profiles', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.public_profiles', 'SELECT') THEN
    RAISE EXCEPTION 'anon, authenticated and service_role must be able to SELECT public_profiles.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.table_privileges AS tp
    WHERE tp.table_schema = 'public'
      AND tp.table_name = 'public_profiles'
      AND tp.privilege_type = 'SELECT'
      AND tp.grantee = 'PUBLIC'
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not have a direct grant on public_profiles.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_own'
      AND cmd = 'SELECT'
      AND roles @> ARRAY['authenticated']::name[]
      AND position('auth.uid()' IN COALESCE(qual, '')) > 0
      AND position('id' IN COALESCE(qual, '')) > 0
  ) THEN
    RAISE EXCEPTION 'profiles_select_own must enforce auth.uid() = id.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_admin'
      AND cmd = 'SELECT'
      AND roles @> ARRAY['authenticated']::name[]
      AND position('is_admin' IN COALESCE(qual, '')) > 0
  ) THEN
    RAISE EXCEPTION 'profiles_select_admin must call the identity-bound admin helper.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies AS p
    CROSS JOIN LATERAL unnest(p.roles) AS role_name
    WHERE p.schemaname = 'public'
      AND p.tablename = 'profiles'
      AND p.cmd IN ('SELECT', 'ALL')
      AND lower(role_name::text) IN ('public', 'anon')
  ) THEN
    RAISE EXCEPTION 'A public/anon SELECT/ALL policy remains on profiles.';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND cmd = 'SELECT'
  ) <> 2 THEN
    RAISE EXCEPTION 'Only the explicit owner and identity-verified admin SELECT policies may remain on profiles.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_update_own'
      AND cmd = 'UPDATE'
      AND position('auth.uid()' IN COALESCE(qual, '')) > 0
      AND position('auth.uid()' IN COALESCE(with_check, '')) > 0
  ) THEN
    RAISE EXCEPTION 'profiles_update_own must constrain both USING and WITH CHECK to auth.uid().';
  END IF;
END;
$profile_projection_preflight$;
