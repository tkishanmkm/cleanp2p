-- Make the canonical p2p_ads row and legacy ads mirror change as one
-- authorized transaction. A failed mirror update must never leave stale visibility.
BEGIN;

DO $ad_status_dependencies$
BEGIN
  IF to_regclass('public.p2p_ads') IS NULL
     OR to_regclass('public.ads') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.admin_audit_logs') IS NULL
     OR to_regclass('auth.users') IS NULL
     OR to_regprocedure('public.is_active_full_admin_actor(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Ad status, profile, audit, Auth or full-admin dependencies are missing.';
  END IF;

  IF NOT EXISTS (
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
      AND column_name='target_user_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='admin_audit_logs'
      AND column_name='details' AND data_type='jsonb'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='admin_audit_logs'
      AND column_name='created_at' AND data_type='timestamp with time zone'
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
      AND column_name='active' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='p2p_ads'
      AND column_name='is_active' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='p2p_ads'
      AND column_name='status' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='p2p_ads'
      AND column_name='public_ad_id' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='p2p_ads'
      AND column_name='ad_type' AND data_type='character varying'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='p2p_ads'
      AND column_name='type' AND data_type='character varying'
  ) OR NOT EXISTS (
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
      AND column_name='active' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ads'
      AND column_name='is_active' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ads'
      AND column_name='status' AND data_type='character varying'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ads'
      AND column_name='public_ad_id' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ads'
      AND column_name='trade_type' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ads'
      AND column_name='type' AND data_type='character varying'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ads'
      AND column_name='updated_at' AND data_type='timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'Deployed ad status table contract does not match this migration.';
  END IF;
END;
$ad_status_dependencies$;

CREATE OR REPLACE FUNCTION public.set_ad_status_atomic_authorized(
    p_actor_id uuid,
    p_actor_email text,
    p_p2p_ad_id uuid,
    p_legacy_ad_id text,
    p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_status text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_status, '')));
    v_actor_email text;
    v_supplied_email text := nullif(pg_catalog.btrim(p_actor_email), '');
    v_owner_id uuid;
    v_p2p_owner_id uuid;
    v_legacy_owner_id uuid;
    v_p2p_direction text;
    v_legacy_direction text;
    v_p2p_public_ad_id text;
    v_legacy_public_ad_id text;
    v_p2p_previous_status text;
    v_legacy_previous_status text;
    v_is_admin boolean := false;
    v_profile_status text;
    v_account_status text;
    v_is_banned boolean;
    v_is_restricted boolean;
    v_is_suspended boolean;
    v_is_on_hold boolean;
    v_is_emergency_frozen boolean;
    v_is_minor_restricted boolean;
BEGIN
    IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_actor_id IS NULL OR (p_p2p_ad_id IS NULL AND p_legacy_ad_id IS NULL) THEN
        RAISE EXCEPTION 'Actor and at least one resolved advertisement row are required.'
            USING ERRCODE = '22023';
    END IF;

    IF v_status NOT IN ('ACTIVE', 'INACTIVE', 'PAUSED', 'HIDDEN', 'DRAFT') THEN
        RAISE EXCEPTION 'Unsupported advertisement status.'
            USING ERRCODE = '22023';
    END IF;

    SELECT nullif(pg_catalog.btrim(u.email), '')
      INTO v_actor_email
      FROM auth.users AS u
     WHERE u.id = p_actor_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Authenticated actor was not found.'
            USING ERRCODE = '42501';
    END IF;

    -- Always lock in canonical-then-legacy order. Both updates and any admin
    -- audit insert occur in this transaction.
    IF p_p2p_ad_id IS NOT NULL THEN
        SELECT a.user_id,
               pg_catalog.upper(pg_catalog.btrim(coalesce(a.ad_type, a.type, ''))),
               a.public_ad_id,
               a.status
          INTO v_p2p_owner_id, v_p2p_direction, v_p2p_public_ad_id, v_p2p_previous_status
          FROM public.p2p_ads AS a
         WHERE a.id = p_p2p_ad_id
         FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Canonical advertisement row was not found.'
                USING ERRCODE = 'P0002';
        END IF;
    END IF;

    IF p_legacy_ad_id IS NOT NULL THEN
        SELECT a.user_id,
               pg_catalog.upper(pg_catalog.btrim(coalesce(a.trade_type, a.type, ''))),
               a.public_ad_id,
               a.status
          INTO v_legacy_owner_id, v_legacy_direction, v_legacy_public_ad_id, v_legacy_previous_status
          FROM public.ads AS a
         WHERE a.id = p_legacy_ad_id
         FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Legacy advertisement mirror row was not found.'
                USING ERRCODE = 'P0002';
        END IF;
    END IF;

    IF v_p2p_owner_id IS NOT NULL
       AND v_legacy_owner_id IS NOT NULL THEN
        IF v_p2p_owner_id <> v_legacy_owner_id THEN
            RAISE EXCEPTION 'Resolved advertisement rows do not belong to the same owner.'
                USING ERRCODE = '42501';
        END IF;

        -- Match the compatibility contract used by the canonical trade RPC:
        -- ads.public_ad_id links to p2p_ads.public_ad_id, or ads.id is the
        -- public identifier / UUID-text fallback of that canonical row.
        IF NOT (
          (v_p2p_public_ad_id IS NOT NULL AND v_legacy_public_ad_id = v_p2p_public_ad_id)
          OR (v_p2p_public_ad_id IS NOT NULL AND p_legacy_ad_id = v_p2p_public_ad_id)
          OR p_legacy_ad_id = p_p2p_ad_id::text
        ) THEN
            RAISE EXCEPTION 'Resolved canonical and legacy advertisement rows are not the same logical listing.'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    v_owner_id := COALESCE(v_p2p_owner_id, v_legacy_owner_id);
    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Advertisement owner could not be resolved.'
            USING ERRCODE = 'P0002';
    END IF;

    IF p_actor_id <> v_owner_id THEN
        IF NOT public.is_active_full_admin_actor(p_actor_id) THEN
            RAISE EXCEPTION 'Advertisement owner or active full administrator is required.'
                USING ERRCODE = '42501';
        END IF;

        IF v_actor_email IS NULL
           OR v_supplied_email IS NULL
           OR pg_catalog.lower(v_actor_email) <> pg_catalog.lower(v_supplied_email) THEN
            RAISE EXCEPTION 'A matching canonical administrator Auth email is required.'
                USING ERRCODE = '42501';
        END IF;
        v_is_admin := true;
    END IF;

    SELECT
      pg_catalog.lower(coalesce(p.status::text, '')),
      pg_catalog.lower(coalesce(p.account_status, 'active')),
      coalesce(p.is_banned, false),
      coalesce(p.is_restricted, false),
      coalesce(p.is_suspended, false),
      coalesce(p.is_on_hold, false),
      coalesce(p.is_emergency_frozen, false),
      coalesce(p.is_minor_restricted, false)
      INTO v_profile_status, v_account_status, v_is_banned, v_is_restricted,
           v_is_suspended, v_is_on_hold, v_is_emergency_frozen, v_is_minor_restricted
      FROM public.profiles AS p
     WHERE p.id = v_owner_id
     FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Advertisement owner profile was not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_status = 'ACTIVE' THEN
        IF v_profile_status <> 'active'
           OR v_account_status <> 'active'
           OR v_is_banned OR v_is_restricted OR v_is_suspended
           OR v_is_on_hold OR v_is_emergency_frozen OR v_is_minor_restricted THEN
            RAISE EXCEPTION 'Restricted or inactive accounts cannot activate advertisements.'
                USING ERRCODE = '42501';
        END IF;

        IF v_p2p_direction = 'SELL' OR v_legacy_direction = 'SELL' THEN
            RAISE EXCEPTION 'SELL advertisements require an atomic inventory reservation before activation.'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF p_p2p_ad_id IS NOT NULL THEN
        UPDATE public.p2p_ads
           SET active = (v_status = 'ACTIVE'),
               is_active = (v_status = 'ACTIVE'),
               status = v_status
         WHERE id = p_p2p_ad_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Canonical advertisement status update did not affect one row.'
                USING ERRCODE = 'P0002';
        END IF;
    END IF;

    IF p_legacy_ad_id IS NOT NULL THEN
        UPDATE public.ads
           SET active = (v_status = 'ACTIVE'),
               is_active = (v_status = 'ACTIVE'),
               status = v_status,
               updated_at = pg_catalog.clock_timestamp()
         WHERE id = p_legacy_ad_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Legacy advertisement mirror update did not affect one row.'
                USING ERRCODE = 'P0002';
        END IF;
    END IF;

    IF v_is_admin THEN
        INSERT INTO public.admin_audit_logs (
            admin_id, admin_email, action, target_id, target_user_id, details, created_at
        ) VALUES (
            p_actor_id,
            v_actor_email,
            'ADMIN_AD_STATUS_CHANGE',
            COALESCE(p_p2p_ad_id::text, p_legacy_ad_id),
            v_owner_id,
            pg_catalog.jsonb_build_object(
              'p2p_ad_id', p_p2p_ad_id,
              'legacy_ad_id', p_legacy_ad_id,
              'previous_p2p_status', v_p2p_previous_status,
              'previous_legacy_status', v_legacy_previous_status,
              'new_status', v_status,
              'actor_id', p_actor_id,
              'changed_at', pg_catalog.clock_timestamp()
            ),
            pg_catalog.clock_timestamp()
        );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'owner_id', v_owner_id,
      'p2p_ad_id', p_p2p_ad_id,
      'legacy_ad_id', p_legacy_ad_id,
      'status', v_status,
      'active', v_status = 'ACTIVE',
      'canonical_updated', p_p2p_ad_id IS NOT NULL,
      'legacy_updated', p_legacy_ad_id IS NOT NULL,
      'audit_logged', CASE WHEN v_is_admin THEN true ELSE null END
    );
END;
$function$;

ALTER FUNCTION public.set_ad_status_atomic_authorized(uuid,text,uuid,text,text) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_ad_status_atomic_authorized(uuid,text,uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.set_ad_status_atomic_authorized(uuid,text,uuid,text,text)
  TO service_role, postgres;

COMMENT ON FUNCTION public.set_ad_status_atomic_authorized(uuid,text,uuid,text,text) IS
  'Atomic owner/full-admin advertisement status update. Locks canonical and legacy rows in a fixed order, verifies owner/admin identity and activation eligibility, blocks unreserved SELL inventory, updates both mirrors and audits admin actions in one transaction.';

NOTIFY pgrst, 'reload schema';
COMMIT;
