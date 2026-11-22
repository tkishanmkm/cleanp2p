-- Make global ad pause/resume/delete a single audited transaction across all deployed ad stores.
-- The legacy advertisements table did not have a status column, so its global-pause
-- marker could not be persisted. Add explicit state while preserving existing flags.
BEGIN;

DO $bulk_ad_dependencies$
BEGIN
  IF to_regclass('public.ads') IS NULL
     OR to_regclass('public.p2p_ads') IS NULL
     OR to_regclass('public.advertisements') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.app_admins') IS NULL
     OR to_regclass('public.system_settings') IS NULL
     OR to_regclass('public.admin_audit_logs') IS NULL
     OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Bulk ad control dependencies are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ads'
       AND column_name='id' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ads'
       AND column_name='user_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ads'
       AND column_name='status' AND data_type='character varying'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ads'
       AND column_name='is_deleted' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ads'
       AND column_name='active' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ads'
       AND column_name='is_active' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ads'
       AND column_name='updated_at' AND data_type='timestamp with time zone'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='p2p_ads'
       AND column_name='id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='p2p_ads'
       AND column_name='user_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='p2p_ads'
       AND column_name='status' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='p2p_ads'
       AND column_name='is_deleted' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='p2p_ads'
       AND column_name='active' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='p2p_ads'
       AND column_name='is_active' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='p2p_ads'
       AND column_name='ad_type' AND data_type='character varying'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='advertisements'
       AND column_name='id' AND data_type='character varying'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='advertisements'
       AND column_name='user_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='advertisements'
       AND column_name='is_active' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='system_settings'
       AND column_name='key' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='system_settings'
       AND column_name='value' AND data_type='jsonb'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='admin_audit_logs'
       AND column_name='admin_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='admin_audit_logs'
       AND column_name='admin_email' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='admin_audit_logs'
       AND column_name='action' AND data_type='character varying'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='admin_audit_logs'
       AND column_name='target_id' AND data_type='character varying'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='admin_audit_logs'
       AND column_name='details' AND data_type='jsonb'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ads'
       AND column_name='type' AND data_type='character varying'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='p2p_ads'
       AND column_name='type' AND data_type='character varying'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='advertisements'
       AND column_name='type' AND data_type='character varying'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles'
       AND column_name='status'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles'
       AND column_name='account_status' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles'
       AND column_name='is_banned' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles'
       AND column_name='is_restricted' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles'
       AND column_name='is_suspended' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles'
       AND column_name='is_on_hold' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles'
       AND column_name='is_emergency_frozen' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles'
       AND column_name='is_minor_restricted' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles'
       AND column_name='is_admin_account' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles'
       AND column_name='role'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='app_admins'
       AND column_name='user_id' AND data_type='uuid'
  ) THEN
    RAISE EXCEPTION 'Deployed ad/system/audit table columns do not match the bulk-control contract.';
  END IF;
END;
$bulk_ad_dependencies$;

ALTER TABLE public.advertisements
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.advertisements
   SET status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END
 WHERE status IS NULL OR pg_catalog.btrim(status) = '';

UPDATE public.advertisements
   SET is_deleted = false
 WHERE is_deleted IS NULL;

ALTER TABLE public.advertisements
  ALTER COLUMN status SET DEFAULT 'ACTIVE',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN is_deleted SET DEFAULT false,
  ALTER COLUMN is_deleted SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now();

DO $legacy_ad_status_schema_guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='advertisements'
       AND column_name='status' AND data_type='text' AND is_nullable='NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='advertisements'
       AND column_name='is_deleted' AND data_type='boolean' AND is_nullable='NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='advertisements'
       AND column_name='updated_at' AND data_type='timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'Legacy advertisements lifecycle columns do not match the expected types.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.advertisements
     WHERE status IS NULL
        OR pg_catalog.upper(pg_catalog.btrim(status)) NOT IN (
          'ACTIVE','INACTIVE','PUBLISHED','PAUSED','HIDDEN','DRAFT','GLOBAL_PAUSED','DELETED'
        )
  ) THEN
    RAISE EXCEPTION 'Legacy advertisements contain an unsupported status; refusing to normalize unknown states.';
  END IF;
END;
$legacy_ad_status_schema_guard$;

DO $legacy_ad_status_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.advertisements'::regclass
       AND conname='advertisements_status_state_check'
  ) THEN
    ALTER TABLE public.advertisements
      ADD CONSTRAINT advertisements_status_state_check
      CHECK (pg_catalog.upper(pg_catalog.btrim(status)) IN (
        'ACTIVE','INACTIVE','PUBLISHED','PAUSED','HIDDEN','DRAFT','GLOBAL_PAUSED','DELETED'
      )) NOT VALID;
  END IF;

  ALTER TABLE public.advertisements
    VALIDATE CONSTRAINT advertisements_status_state_check;
END;
$legacy_ad_status_constraint$;

CREATE OR REPLACE FUNCTION public.admin_bulk_ads_action_atomic(
  p_admin_id uuid,
  p_admin_email text,
  p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_action text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_action, '')));
  v_actor_email text;
  v_supplied_email text := nullif(pg_catalog.btrim(p_admin_email), '');
  v_admin_profile_role text;
  v_admin_profile_status text;
  v_admin_account_status text;
  v_admin_is_admin_flag boolean := false;
  v_admin_is_admin_account boolean := false;
  v_admin_is_banned boolean := false;
  v_admin_is_restricted boolean := false;
  v_admin_is_suspended boolean := false;
  v_admin_is_on_hold boolean := false;
  v_admin_is_emergency_frozen boolean := false;
  v_admin_is_minor_restricted boolean := false;
  v_admin_has_app_admin_grant boolean := false;
  v_admin_is_support_admin boolean := false;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_eligible_owner_ids uuid[] := ARRAY[]::uuid[];
  v_owner_id uuid;
  v_profile_status text;
  v_account_status text;
  v_is_banned boolean;
  v_is_restricted boolean;
  v_is_suspended boolean;
  v_is_on_hold boolean;
  v_is_emergency_frozen boolean;
  v_is_minor_restricted boolean;
  v_ads_count bigint := 0;
  v_p2p_ads_count bigint := 0;
  v_legacy_ads_count bigint := 0;
  v_skipped_count bigint := 0;
  v_total_paused_count bigint := 0;
  v_affected_count bigint := 0;
  v_audit_action text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted server execution required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_admin_id IS NULL OR v_supplied_email IS NULL THEN
    RAISE EXCEPTION 'Canonical administrator identity is required.'
      USING ERRCODE = '22023';
  END IF;

  IF v_action NOT IN ('PAUSE', 'RESUME', 'DELETE') THEN
    RAISE EXCEPTION 'Unsupported bulk ad action.'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    pg_catalog.lower(coalesce(p.role::text, '')),
    pg_catalog.lower(coalesce(p.status::text, '')),
    pg_catalog.lower(coalesce(p.account_status, '')),
    coalesce(p.is_admin, false),
    coalesce(p.is_admin_account, false),
    coalesce(p.is_banned, false),
    coalesce(p.is_restricted, false),
    coalesce(p.is_suspended, false),
    coalesce(p.is_on_hold, false),
    coalesce(p.is_emergency_frozen, false),
    coalesce(p.is_minor_restricted, false)
    INTO
      v_admin_profile_role,
      v_admin_profile_status,
      v_admin_account_status,
      v_admin_is_admin_flag,
      v_admin_is_admin_account,
      v_admin_is_banned,
      v_admin_is_restricted,
      v_admin_is_suspended,
      v_admin_is_on_hold,
      v_admin_is_emergency_frozen,
      v_admin_is_minor_restricted
    FROM public.profiles AS p
   WHERE p.id = p_admin_id
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrator profile was not found.'
      USING ERRCODE = '42501';
  END IF;

  IF v_admin_profile_status IS DISTINCT FROM 'active'
     OR v_admin_account_status IS DISTINCT FROM 'active'
     OR v_admin_is_banned
     OR v_admin_is_restricted
     OR v_admin_is_suspended
     OR v_admin_is_on_hold
     OR v_admin_is_emergency_frozen
     OR v_admin_is_minor_restricted THEN
    RAISE EXCEPTION 'Administrator account is inactive, restricted or frozen.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public'
       AND table_name='app_admins'
       AND column_name='role'
  ) THEN
    EXECUTE $bulk_admin_registry_sql$
      SELECT EXISTS (
        SELECT 1 FROM public.app_admins
         WHERE user_id = $1
           AND pg_catalog.lower(coalesce(role, '')) IN ('admin', 'superadmin')
      )
    $bulk_admin_registry_sql$
      INTO v_admin_has_app_admin_grant
      USING p_admin_id;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.app_admins AS aa
       WHERE aa.user_id = p_admin_id
    )
    INTO v_admin_has_app_admin_grant;
  END IF;

  IF to_regclass('public.support_admin_grants') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='support_admin_grants'
          AND column_name='user_id'
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='support_admin_grants'
          AND column_name='is_enabled'
     ) THEN
    EXECUTE
      'SELECT EXISTS (
         SELECT 1 FROM public.support_admin_grants
          WHERE user_id = $1
            AND is_enabled = true
       )'
      INTO v_admin_is_support_admin
      USING p_admin_id;
  END IF;

  IF v_admin_is_support_admin THEN
    RAISE EXCEPTION 'Support administrators cannot perform bulk advertisement controls.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    v_admin_is_admin_flag
    OR v_admin_is_admin_account
    OR v_admin_profile_role IN ('admin', 'superadmin')
    OR v_admin_has_app_admin_grant
  ) THEN
    RAISE EXCEPTION 'A durable full-administrator grant is required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT nullif(pg_catalog.btrim(u.email), '')
    INTO v_actor_email
    FROM auth.users AS u
   WHERE u.id = p_admin_id;

  IF NOT FOUND OR v_actor_email IS NULL
     OR pg_catalog.lower(v_actor_email) <> pg_catalog.lower(v_supplied_email) THEN
    RAISE EXCEPTION 'Administrator email does not match the canonical Auth identity.'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize global bulk actions with each other, then lock canonical
  -- marketplace rows in the same p2p_ads -> ads order as per-ad status RPCs.
  -- Legacy advertisements are updated only after any owner-profile locks below:
  -- admin account-status RPCs lock profiles before touching that legacy table.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wayones:bulk-ad-controls:v1', 0)
  );
  PERFORM 1 FROM public.p2p_ads AS a ORDER BY a.id FOR UPDATE;
  PERFORM 1 FROM public.ads AS a ORDER BY a.id FOR UPDATE;

  IF v_action = 'PAUSE' THEN
    UPDATE public.ads AS a
       SET status = 'GLOBAL_PAUSED',
           active = false,
           is_active = false,
           updated_at = v_now
     WHERE coalesce(a.is_deleted, false) = false
       AND pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) <> 'DELETED'
       AND (
         pg_catalog.lower(pg_catalog.btrim(coalesce(a.status, ''))) IN ('active', 'published')
         OR coalesce(a.active, false)
         OR coalesce(a.is_active, false)
       );
    GET DIAGNOSTICS v_ads_count = ROW_COUNT;

    UPDATE public.p2p_ads AS a
       SET status = 'GLOBAL_PAUSED',
           active = false,
           is_active = false
     WHERE coalesce(a.is_deleted, false) = false
       AND pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) <> 'DELETED'
       AND (
         pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) = 'ACTIVE'
         OR coalesce(a.active, false)
         OR coalesce(a.is_active, false)
       );
    GET DIAGNOSTICS v_p2p_ads_count = ROW_COUNT;

    PERFORM 1 FROM public.advertisements AS a ORDER BY a.id FOR UPDATE;

    UPDATE public.advertisements AS a
       SET status = 'GLOBAL_PAUSED',
           is_active = false,
           updated_at = v_now
     WHERE coalesce(a.is_deleted, false) = false
       AND pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) <> 'DELETED'
       AND a.is_active = true;
    GET DIAGNOSTICS v_legacy_ads_count = ROW_COUNT;

    INSERT INTO public.system_settings (key, value, updated_at)
    VALUES ('all_ads_paused_at', pg_catalog.to_jsonb(v_now), v_now)
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at;

    v_audit_action := 'BULK_ADS_PAUSED';
    v_affected_count := v_ads_count + v_p2p_ads_count + v_legacy_ads_count;

  ELSIF v_action = 'RESUME' THEN
    SELECT
      (SELECT pg_catalog.count(*) FROM public.ads a
        WHERE pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) = 'GLOBAL_PAUSED'
          AND coalesce(a.is_deleted, false) = false)
      + (SELECT pg_catalog.count(*) FROM public.p2p_ads a
        WHERE pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) = 'GLOBAL_PAUSED'
          AND coalesce(a.is_deleted, false) = false)
      + (SELECT pg_catalog.count(*) FROM public.advertisements a
        WHERE pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) = 'GLOBAL_PAUSED'
          AND coalesce(a.is_deleted, false) = false)
      INTO v_total_paused_count;

    -- Lock each affected owner only after ad rows, matching the lock order of
    -- ordinary status updates and trade creation. Restricted owners and SELL
    -- advertisements remain paused until their respective gates are satisfied.
    FOR v_owner_id IN
      SELECT owners.owner_id
        FROM (
          SELECT a.user_id AS owner_id
            FROM public.ads AS a
           WHERE pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) = 'GLOBAL_PAUSED'
             AND coalesce(a.is_deleted, false) = false
          UNION
          SELECT a.user_id AS owner_id
            FROM public.p2p_ads AS a
           WHERE pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) = 'GLOBAL_PAUSED'
             AND coalesce(a.is_deleted, false) = false
          UNION
          SELECT a.user_id AS owner_id
            FROM public.advertisements AS a
           WHERE pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) = 'GLOBAL_PAUSED'
             AND coalesce(a.is_deleted, false) = false
        ) AS owners
       WHERE owners.owner_id IS NOT NULL
       ORDER BY owners.owner_id
    LOOP
      SELECT
        pg_catalog.lower(coalesce(p.status::text, '')),
        pg_catalog.lower(coalesce(p.account_status, '')),
        coalesce(p.is_banned, false),
        coalesce(p.is_restricted, false),
        coalesce(p.is_suspended, false),
        coalesce(p.is_on_hold, false),
        coalesce(p.is_emergency_frozen, false),
        coalesce(p.is_minor_restricted, false)
        INTO
          v_profile_status,
          v_account_status,
          v_is_banned,
          v_is_restricted,
          v_is_suspended,
          v_is_on_hold,
          v_is_emergency_frozen,
          v_is_minor_restricted
        FROM public.profiles AS p
       WHERE p.id = v_owner_id
       FOR SHARE;

      IF FOUND
         AND v_profile_status = 'active'
         AND v_account_status = 'active'
         AND NOT v_is_banned
         AND NOT v_is_restricted
         AND NOT v_is_suspended
         AND NOT v_is_on_hold
         AND NOT v_is_emergency_frozen
         AND NOT v_is_minor_restricted THEN
        v_eligible_owner_ids := pg_catalog.array_append(v_eligible_owner_ids, v_owner_id);
      END IF;
    END LOOP;

    UPDATE public.ads AS a
       SET status = 'active',
           active = true,
           is_active = true,
           updated_at = v_now
     WHERE pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) = 'GLOBAL_PAUSED'
       AND coalesce(a.is_deleted, false) = false
       AND pg_catalog.upper(pg_catalog.btrim(coalesce(a.type, ''))) <> 'SELL'
       AND a.user_id = ANY(v_eligible_owner_ids);
    GET DIAGNOSTICS v_ads_count = ROW_COUNT;

    UPDATE public.p2p_ads AS a
       SET status = 'ACTIVE',
           active = true,
           is_active = true
     WHERE pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) = 'GLOBAL_PAUSED'
       AND coalesce(a.is_deleted, false) = false
       AND pg_catalog.upper(pg_catalog.btrim(coalesce(a.ad_type, a.type, ''))) <> 'SELL'
       AND a.user_id = ANY(v_eligible_owner_ids);
    GET DIAGNOSTICS v_p2p_ads_count = ROW_COUNT;

    PERFORM 1 FROM public.advertisements AS a ORDER BY a.id FOR UPDATE;

    UPDATE public.advertisements AS a
       SET status = 'ACTIVE',
           is_active = true,
           updated_at = v_now
     WHERE pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))) = 'GLOBAL_PAUSED'
       AND coalesce(a.is_deleted, false) = false
       AND pg_catalog.upper(pg_catalog.btrim(coalesce(a.type, ''))) <> 'SELL'
       AND a.user_id = ANY(v_eligible_owner_ids);
    GET DIAGNOSTICS v_legacy_ads_count = ROW_COUNT;

    v_affected_count := v_ads_count + v_p2p_ads_count + v_legacy_ads_count;
    v_skipped_count := greatest(v_total_paused_count - v_affected_count, 0);

    DELETE FROM public.system_settings
     WHERE key = 'all_ads_paused_at';

    v_audit_action := 'BULK_ADS_RESUMED';

  ELSE
    UPDATE public.ads AS a
       SET status = 'DELETED',
           active = false,
           is_active = false,
           is_deleted = true,
           updated_at = v_now
     WHERE coalesce(a.is_deleted, false) = false;
    GET DIAGNOSTICS v_ads_count = ROW_COUNT;

    UPDATE public.p2p_ads AS a
       SET status = 'DELETED',
           active = false,
           is_active = false,
           is_deleted = true
     WHERE coalesce(a.is_deleted, false) = false;
    GET DIAGNOSTICS v_p2p_ads_count = ROW_COUNT;

    PERFORM 1 FROM public.advertisements AS a ORDER BY a.id FOR UPDATE;

    UPDATE public.advertisements AS a
       SET status = 'DELETED',
           is_active = false,
           is_deleted = true,
           updated_at = v_now
     WHERE coalesce(a.is_deleted, false) = false;
    GET DIAGNOSTICS v_legacy_ads_count = ROW_COUNT;

    v_affected_count := v_ads_count + v_p2p_ads_count + v_legacy_ads_count;
    v_audit_action := 'BULK_ADS_DELETED';
  END IF;

  INSERT INTO public.admin_audit_logs (
    admin_id,
    admin_email,
    action,
    target_id,
    details,
    created_at
  ) VALUES (
    p_admin_id,
    v_actor_email,
    v_audit_action,
    'ALL_ADS',
    pg_catalog.jsonb_build_object(
      'action', v_action,
      'affected_count', v_affected_count,
      'ads_count', v_ads_count,
      'p2p_ads_count', v_p2p_ads_count,
      'legacy_advertisements_count', v_legacy_ads_count,
      'skipped_count', v_skipped_count,
      'executed_at', v_now
    ),
    v_now
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'action', v_action,
    'affected_count', v_affected_count,
    'ads_count', v_ads_count,
    'p2p_ads_count', v_p2p_ads_count,
    'legacy_advertisements_count', v_legacy_ads_count,
    'skipped_count', v_skipped_count,
    'executed_at', v_now
  );
END;
$function$;

ALTER FUNCTION public.admin_bulk_ads_action_atomic(uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_bulk_ads_action_atomic(uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_bulk_ads_action_atomic(uuid,text,text)
  TO service_role, postgres;

COMMENT ON FUNCTION public.admin_bulk_ads_action_atomic(uuid,text,text) IS
  'Atomic full-admin bulk pause/resume/soft-delete across ads, p2p_ads and legacy advertisements. Row-locks stores in stable order, resumes only globally paused BUY ads belonging to active unrestricted owners, sets/clears the global pause marker, and writes an in-transaction audit record.';

NOTIFY pgrst, 'reload schema';
COMMIT;
