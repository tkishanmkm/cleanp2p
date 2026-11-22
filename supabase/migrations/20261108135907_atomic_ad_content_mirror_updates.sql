-- Atomic content edits for the canonical P2P ad and legacy ads mirror.
-- No wallet, escrow, inventory, status, or trade state is changed here.
BEGIN;

DO $ad_content_dependencies$
DECLARE
  v_missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regclass('public.p2p_ads') IS NULL THEN v_missing := array_append(v_missing, 'public.p2p_ads'); END IF;
  IF to_regclass('public.ads') IS NULL THEN v_missing := array_append(v_missing, 'public.ads'); END IF;
  IF to_regclass('public.profiles') IS NULL THEN v_missing := array_append(v_missing, 'public.profiles'); END IF;
  IF to_regclass('public.admin_audit_logs') IS NULL THEN v_missing := array_append(v_missing, 'public.admin_audit_logs'); END IF;
  IF to_regclass('auth.users') IS NULL THEN v_missing := array_append(v_missing, 'auth.users'); END IF;
  IF to_regprocedure('public.is_active_full_admin_actor(uuid)') IS NULL THEN
    v_missing := array_append(v_missing, 'public.is_active_full_admin_actor(uuid)');
  END IF;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'Atomic ad content dependencies are missing: %', array_to_string(v_missing, ', ');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='p2p_ads' AND column_name='id' AND data_type='uuid')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='p2p_ads' AND column_name='user_id' AND data_type='uuid')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='p2p_ads' AND column_name='public_ad_id' AND data_type='text')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='p2p_ads' AND column_name='price' AND data_type='numeric')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='p2p_ads' AND column_name='min_limit' AND data_type='numeric')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='p2p_ads' AND column_name='max_limit' AND data_type='numeric')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='p2p_ads' AND column_name='payment_method' AND data_type='character varying')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='p2p_ads' AND column_name='payment_methods' AND data_type='jsonb')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='p2p_ads' AND column_name='terms' AND data_type='text')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='p2p_ads' AND column_name='is_deleted' AND data_type='boolean')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ads' AND column_name='id' AND data_type='text')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ads' AND column_name='user_id' AND data_type='uuid')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ads' AND column_name='public_ad_id' AND data_type='text')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ads' AND column_name='price' AND data_type='numeric')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ads' AND column_name='min_limit' AND data_type='numeric')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ads' AND column_name='max_limit' AND data_type='numeric')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ads' AND column_name='payment_methods' AND data_type='ARRAY')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ads' AND column_name='updated_at' AND data_type='timestamp with time zone')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ads' AND column_name='is_deleted' AND data_type='boolean')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='status')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='account_status' AND data_type='text')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='is_banned' AND data_type='boolean')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='is_restricted' AND data_type='boolean')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='is_suspended' AND data_type='boolean')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='is_on_hold' AND data_type='boolean')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='is_emergency_frozen' AND data_type='boolean')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='is_minor_restricted' AND data_type='boolean')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_audit_logs' AND column_name='admin_id' AND data_type='uuid')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_audit_logs' AND column_name='admin_email' AND data_type='text')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_audit_logs' AND column_name='action' AND data_type='character varying')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_audit_logs' AND column_name='target_id' AND data_type='character varying')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_audit_logs' AND column_name='target_user_id' AND data_type='uuid')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_audit_logs' AND column_name='details' AND data_type='jsonb') THEN
    RAISE EXCEPTION 'The deployed ad/profile/audit schema does not match the atomic content-edit contract.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('p2p_ads','ad_type','character varying'), ('p2p_ads','type','character varying'),
        ('p2p_ads','asset_symbol','character varying'), ('p2p_ads','crypto_currency','character varying'),
        ('p2p_ads','coin','text'), ('p2p_ads','fiat_symbol','character varying'),
        ('p2p_ads','fiat_currency','character varying'), ('p2p_ads','pricing_type','character varying'),
        ('p2p_ads','margin','numeric'), ('p2p_ads','min_completed_trades_req','integer'),
        ('p2p_ads','status','text'),
        ('ads','unit_price','numeric'), ('ads','min_amount','numeric'), ('ads','max_amount','numeric'),
        ('ads','asset_symbol','character varying'), ('ads','asset','text'), ('ads','coin','text'),
        ('ads','crypto_currency','text'), ('ads','token_symbol','text'),
        ('ads','fiat_symbol','character varying'), ('ads','fiat_currency','text'), ('ads','currency','text'),
        ('ads','terms','text'), ('ads','pricing_type','text'), ('ads','price_type','text'),
        ('ads','rate_type','text'), ('ads','is_fixed','boolean'), ('ads','fixed_rate','numeric'),
        ('ads','fixed_price','numeric'), ('ads','margin','numeric'), ('ads','margin_percentage','numeric'),
        ('ads','rate_percent','numeric'), ('ads','rate_adjustment','numeric'), ('ads','price_margin','numeric'),
        ('ads','margin_rate','numeric'), ('ads','trade_type','text'), ('ads','type','character varying'),
        ('ads','payment_window','integer'), ('ads','payment_window_minutes','integer'),
        ('ads','payment_time_limit','integer'), ('ads','tags','ARRAY'), ('ads','ad_tags','ARRAY'),
        ('ads','targeted_countries','ARRAY'), ('ads','blocked_countries','ARRAY'),
        ('ads','offer_label','text'), ('ads','label','text'),
        ('ads','require_full_name_verified','boolean'), ('ads','require_verified_users','boolean'),
        ('ads','min_completed_trades','integer'), ('ads','min_trade_count','integer'), ('ads','auto_reply','text')
      ) AS required(table_name, column_name, data_type)
      LEFT JOIN information_schema.columns AS actual
        ON actual.table_schema='public'
       AND actual.table_name=required.table_name
       AND actual.column_name=required.column_name
       AND actual.data_type=required.data_type
     WHERE actual.column_name IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more columns required by the atomic ad content RPC are missing or have incompatible types.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='p2p_ads' AND column_name='updated_at'
  ) THEN
    RAISE NOTICE 'p2p_ads.updated_at exists; this RPC intentionally does not depend on it.';
  END IF;
END;
$ad_content_dependencies$;

CREATE OR REPLACE FUNCTION public.update_ad_content_atomic_authorized(
  p_actor_id uuid,
  p_actor_email text,
  p_p2p_ad_id uuid,
  p_legacy_ad_id text,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_email text;
  v_supplied_email text := nullif(pg_catalog.btrim(p_actor_email), '');
  v_owner_id uuid;
  v_p2p_owner_id uuid;
  v_legacy_owner_id uuid;
  v_p2p_public_ad_id text;
  v_legacy_public_ad_id text;
  v_p2p_direction text;
  v_legacy_direction text;
  v_p2p_status text;
  v_legacy_status text;
  v_p2p_deleted boolean := false;
  v_legacy_deleted boolean := false;
  v_p2p_price numeric;
  v_legacy_price numeric;
  v_p2p_min numeric;
  v_legacy_min numeric;
  v_p2p_max numeric;
  v_legacy_max numeric;
  v_p2p_asset text;
  v_legacy_asset text;
  v_p2p_fiat text;
  v_legacy_fiat text;
  v_p2p_methods jsonb;
  v_p2p_payment_method text;
  v_legacy_methods text[];
  v_p2p_terms text;
  v_legacy_terms text;
  v_p2p_pricing text;
  v_legacy_pricing text;
  v_p2p_margin numeric;
  v_legacy_margin numeric;
  v_current_price numeric;
  v_current_min numeric;
  v_current_max numeric;
  v_asset text;
  v_fiat text;
  v_methods jsonb;
  v_method_array text[];
  v_terms text;
  v_pricing_type text;
  v_margin numeric;
  v_direction text;
  v_min_completed_trades integer;
  v_payment_window integer;
  v_is_admin boolean := false;
  v_profile_status text;
  v_account_status text;
  v_is_banned boolean;
  v_is_restricted boolean;
  v_is_suspended boolean;
  v_is_on_hold boolean;
  v_is_emergency_frozen boolean;
  v_is_minor_restricted boolean;
  v_changed_fields text[];
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted server execution required.' USING ERRCODE = '42501';
  END IF;

  IF p_actor_id IS NULL OR (p_p2p_ad_id IS NULL AND p_legacy_ad_id IS NULL) THEN
    RAISE EXCEPTION 'Actor and at least one resolved advertisement row are required.' USING ERRCODE = '22023';
  END IF;

  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch)) THEN
    RAISE EXCEPTION 'A non-empty advertisement content patch is required.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_object_keys(p_patch) AS supplied(key)
     WHERE supplied.key <> ALL (ARRAY[
       'price','min_limit','max_limit','asset_symbol','fiat_symbol',
       'payment_methods','terms','pricing_type','margin','direction',
       'min_completed_trades','payment_window','tags','targeted_countries',
       'blocked_countries','offer_label','require_full_name_verified',
       'require_verified_users','auto_reply'
     ]::text[])
  ) THEN
    RAISE EXCEPTION 'The advertisement patch contains unsupported fields.' USING ERRCODE = '22023';
  END IF;

  IF p_legacy_ad_id IS NULL AND (
       p_patch ? 'payment_window'
       OR p_patch ? 'tags'
       OR p_patch ? 'targeted_countries'
       OR p_patch ? 'blocked_countries'
       OR p_patch ? 'offer_label'
       OR p_patch ? 'require_full_name_verified'
       OR p_patch ? 'require_verified_users'
       OR p_patch ? 'auto_reply'
     ) THEN
    RAISE EXCEPTION 'The legacy advertisement mirror is required to store one or more supplied fields.' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'price' AND (pg_catalog.jsonb_typeof(p_patch->'price') IS DISTINCT FROM 'number' OR (p_patch->>'price')::numeric <= 0 OR (p_patch->>'price')::numeric >= 1000000000000000000) THEN
    RAISE EXCEPTION 'Price must be a finite positive value below 1e18.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'min_limit' AND (pg_catalog.jsonb_typeof(p_patch->'min_limit') IS DISTINCT FROM 'number' OR (p_patch->>'min_limit')::numeric <= 0 OR (p_patch->>'min_limit')::numeric >= 1000000000000000000) THEN
    RAISE EXCEPTION 'Minimum trade limit must be positive and below 1e18.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'max_limit' AND (pg_catalog.jsonb_typeof(p_patch->'max_limit') IS DISTINCT FROM 'number' OR (p_patch->>'max_limit')::numeric <= 0 OR (p_patch->>'max_limit')::numeric >= 1000000000000000000) THEN
    RAISE EXCEPTION 'Maximum trade limit must be positive and below 1e18.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'margin' AND (pg_catalog.jsonb_typeof(p_patch->'margin') IS DISTINCT FROM 'number' OR (p_patch->>'margin')::numeric < -50 OR (p_patch->>'margin')::numeric > 50) THEN
    RAISE EXCEPTION 'Dynamic pricing margin must be between -50 and +50.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'pricing_type' AND (pg_catalog.upper(p_patch->>'pricing_type') IS DISTINCT FROM 'FIXED' AND pg_catalog.upper(p_patch->>'pricing_type') IS DISTINCT FROM 'FLOAT') THEN
    RAISE EXCEPTION 'Pricing type must be FIXED or FLOAT.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'direction' AND pg_catalog.upper(p_patch->>'direction') IS DISTINCT FROM 'BUY' THEN
    RAISE EXCEPTION 'Advertisement direction cannot be changed to SELL without atomic inventory reservation.' USING ERRCODE = '23514';
  END IF;
  IF p_patch ? 'asset_symbol' AND (pg_catalog.jsonb_typeof(p_patch->'asset_symbol') IS DISTINCT FROM 'string' OR pg_catalog.length(pg_catalog.btrim(p_patch->>'asset_symbol')) NOT BETWEEN 2 AND 12) THEN
    RAISE EXCEPTION 'Asset symbol is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'fiat_symbol' AND (pg_catalog.jsonb_typeof(p_patch->'fiat_symbol') IS DISTINCT FROM 'string' OR pg_catalog.length(pg_catalog.btrim(p_patch->>'fiat_symbol')) NOT BETWEEN 3 AND 12) THEN
    RAISE EXCEPTION 'Fiat symbol is invalid.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'terms' AND (pg_catalog.jsonb_typeof(p_patch->'terms') IS DISTINCT FROM 'string' OR pg_catalog.length(p_patch->>'terms') > 2000) THEN
    RAISE EXCEPTION 'Advertisement terms must be text of at most 2000 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'offer_label' AND (pg_catalog.jsonb_typeof(p_patch->'offer_label') IS DISTINCT FROM 'string' OR pg_catalog.length(p_patch->>'offer_label') > 120) THEN
    RAISE EXCEPTION 'Offer label must be text of at most 120 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'auto_reply' AND (pg_catalog.jsonb_typeof(p_patch->'auto_reply') IS DISTINCT FROM 'string' OR pg_catalog.length(p_patch->>'auto_reply') > 2000) THEN
    RAISE EXCEPTION 'Auto reply must be text of at most 2000 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'payment_methods' THEN
    IF pg_catalog.jsonb_typeof(p_patch->'payment_methods') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(p_patch->'payment_methods') NOT BETWEEN 1 AND 20
       OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_patch->'payment_methods') AS m(value)
                   WHERE pg_catalog.jsonb_typeof(m.value) <> 'string'
                      OR pg_catalog.length(pg_catalog.btrim(m.value #>> '{}')) NOT BETWEEN 1 AND 80) THEN
      RAISE EXCEPTION 'One to twenty valid payment methods are required.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_patch ? 'min_completed_trades' AND (
       pg_catalog.jsonb_typeof(p_patch->'min_completed_trades') IS DISTINCT FROM 'number'
       OR (p_patch->>'min_completed_trades')::numeric < 0
       OR (p_patch->>'min_completed_trades')::numeric > 1000000
       OR (p_patch->>'min_completed_trades')::numeric <> pg_catalog.trunc((p_patch->>'min_completed_trades')::numeric)
     ) THEN
    RAISE EXCEPTION 'Minimum completed trades must be a whole number from 0 to 1000000.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'payment_window' AND (
       pg_catalog.jsonb_typeof(p_patch->'payment_window') IS DISTINCT FROM 'number'
       OR (p_patch->>'payment_window')::numeric < 30
       OR (p_patch->>'payment_window')::numeric > 1440
       OR (p_patch->>'payment_window')::numeric <> pg_catalog.trunc((p_patch->>'payment_window')::numeric)
     ) THEN
    RAISE EXCEPTION 'Payment window must be a whole number between 30 and 1440 minutes.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'tags' AND (
       pg_catalog.jsonb_typeof(p_patch->'tags') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(p_patch->'tags') > 20
       OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_patch->'tags') AS t(value)
                   WHERE pg_catalog.jsonb_typeof(t.value) <> 'string'
                      OR pg_catalog.length(pg_catalog.btrim(t.value #>> '{}')) > 50)
     ) THEN
    RAISE EXCEPTION 'Advertisement tags must be an array of at most 20 short text values.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'targeted_countries' AND (
       pg_catalog.jsonb_typeof(p_patch->'targeted_countries') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(p_patch->'targeted_countries') > 100
       OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_patch->'targeted_countries') AS c(value)
                   WHERE pg_catalog.jsonb_typeof(c.value) <> 'string'
                      OR (pg_catalog.length(pg_catalog.btrim(c.value #>> '{}')) NOT BETWEEN 2 AND 3 OR (c.value #>> '{}') !~ '^[A-Za-z]{2,3}$'))
     ) THEN
    RAISE EXCEPTION 'Targeted countries must be an array of valid country codes.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'blocked_countries' AND (
       pg_catalog.jsonb_typeof(p_patch->'blocked_countries') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(p_patch->'blocked_countries') > 100
       OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_patch->'blocked_countries') AS c(value)
                   WHERE pg_catalog.jsonb_typeof(c.value) <> 'string'
                      OR (pg_catalog.length(pg_catalog.btrim(c.value #>> '{}')) NOT BETWEEN 2 AND 3 OR (c.value #>> '{}') !~ '^[A-Za-z]{2,3}$'))
     ) THEN
    RAISE EXCEPTION 'Blocked countries must be an array of valid country codes.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'require_full_name_verified' AND pg_catalog.jsonb_typeof(p_patch->'require_full_name_verified') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'require_full_name_verified must be a boolean.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'require_verified_users' AND pg_catalog.jsonb_typeof(p_patch->'require_verified_users') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'require_verified_users must be a boolean.' USING ERRCODE = '22023';
  END IF;

  SELECT nullif(pg_catalog.btrim(u.email), '')
    INTO v_actor_email
    FROM auth.users AS u
   WHERE u.id = p_actor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authenticated actor was not found.' USING ERRCODE = '42501';
  END IF;

  -- Lock canonical first, then legacy, matching the status-mutation lock order.
  IF p_p2p_ad_id IS NOT NULL THEN
    SELECT a.user_id, a.public_ad_id,
           pg_catalog.upper(pg_catalog.btrim(coalesce(a.ad_type, a.type, ''))),
           pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))),
           coalesce(a.is_deleted, false),
           a.price, a.min_limit, a.max_limit,
           coalesce(a.asset_symbol, a.crypto_currency, a.coin),
           coalesce(a.fiat_symbol, a.fiat_currency),
           a.payment_methods, a.payment_method, a.terms,
           a.pricing_type, a.margin
      INTO v_p2p_owner_id, v_p2p_public_ad_id, v_p2p_direction,
           v_p2p_status, v_p2p_deleted, v_p2p_price, v_p2p_min,
           v_p2p_max, v_p2p_asset, v_p2p_fiat, v_p2p_methods,
           v_p2p_payment_method, v_p2p_terms, v_p2p_pricing, v_p2p_margin
      FROM public.p2p_ads AS a
     WHERE a.id = p_p2p_ad_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Canonical advertisement row was not found.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF p_legacy_ad_id IS NOT NULL THEN
    SELECT a.user_id, a.public_ad_id,
           pg_catalog.upper(pg_catalog.btrim(coalesce(a.trade_type, a.type, ''))),
           pg_catalog.upper(pg_catalog.btrim(coalesce(a.status, ''))),
           coalesce(a.is_deleted, false),
           a.price, a.min_limit, a.max_limit,
           coalesce(a.asset_symbol, a.asset, a.coin, a.crypto_currency),
           coalesce(a.fiat_symbol, a.fiat_currency, a.currency),
           a.payment_methods, a.terms,
           coalesce(a.pricing_type, a.price_type, CASE WHEN a.is_fixed OR lower(coalesce(a.rate_type,''))='fixed' THEN 'FIXED' ELSE 'FLOAT' END),
           coalesce(a.margin, a.margin_percentage, a.rate_percent, a.rate_adjustment, a.price_margin, a.margin_rate)
      INTO v_legacy_owner_id, v_legacy_public_ad_id, v_legacy_direction,
           v_legacy_status, v_legacy_deleted, v_legacy_price, v_legacy_min,
           v_legacy_max, v_legacy_asset, v_legacy_fiat, v_legacy_methods,
           v_legacy_terms, v_legacy_pricing, v_legacy_margin
      FROM public.ads AS a
     WHERE a.id = p_legacy_ad_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Legacy advertisement mirror row was not found.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF v_p2p_owner_id IS NOT NULL AND v_legacy_owner_id IS NOT NULL THEN
    IF v_p2p_owner_id <> v_legacy_owner_id THEN
      RAISE EXCEPTION 'Resolved advertisement rows do not belong to the same owner.' USING ERRCODE = '42501';
    END IF;
    IF NOT (
      (v_p2p_public_ad_id IS NOT NULL AND v_legacy_public_ad_id = v_p2p_public_ad_id)
      OR (v_p2p_public_ad_id IS NOT NULL AND p_legacy_ad_id = v_p2p_public_ad_id)
      OR p_legacy_ad_id = p_p2p_ad_id::text
    ) THEN
      RAISE EXCEPTION 'Resolved canonical and legacy rows are not the same logical listing.' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_owner_id := coalesce(v_p2p_owner_id, v_legacy_owner_id);
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Advertisement owner could not be resolved.' USING ERRCODE = 'P0002';
  END IF;

  v_is_admin := public.is_active_full_admin_actor(p_actor_id);
  IF v_is_admin THEN
    IF v_actor_email IS NULL OR v_supplied_email IS NULL
       OR pg_catalog.lower(v_actor_email) <> pg_catalog.lower(v_supplied_email) THEN
      RAISE EXCEPTION 'A matching canonical administrator Auth email is required.' USING ERRCODE = '42501';
    END IF;
  ELSIF p_actor_id <> v_owner_id THEN
    RAISE EXCEPTION 'Advertisement owner or active full administrator is required.' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.lower(coalesce(p.status::text, '')),
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
   WHERE p.id = v_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advertisement owner profile was not found.' USING ERRCODE = 'P0002';
  END IF;

  IF p_actor_id = v_owner_id AND (
       v_profile_status <> 'active' OR v_account_status <> 'active'
       OR v_is_banned OR v_is_restricted OR v_is_suspended OR v_is_on_hold
       OR v_is_emergency_frozen OR v_is_minor_restricted
     ) THEN
    RAISE EXCEPTION 'An inactive or restricted account cannot edit its advertisement.' USING ERRCODE = '42501';
  END IF;

  IF v_p2p_deleted OR v_legacy_deleted OR v_p2p_status = 'DELETED' OR v_legacy_status = 'DELETED' THEN
    RAISE EXCEPTION 'Deleted advertisements are terminal and cannot be edited.' USING ERRCODE = '23514';
  END IF;

  IF nullif(v_p2p_direction, '') IS NOT NULL
     AND nullif(v_legacy_direction, '') IS NOT NULL
     AND v_p2p_direction <> v_legacy_direction THEN
    RAISE EXCEPTION 'Canonical and legacy advertisement directions do not match.' USING ERRCODE = '22023';
  END IF;
  v_direction := coalesce(nullif(v_p2p_direction, ''), nullif(v_legacy_direction, ''));
  IF v_direction = 'SELL' OR v_p2p_direction = 'SELL' OR v_legacy_direction = 'SELL' THEN
    RAISE EXCEPTION 'SELL advertisements cannot be edited until atomic inventory reservation is enabled.' USING ERRCODE = '23514';
  END IF;
  IF v_direction IS DISTINCT FROM 'BUY' THEN
    RAISE EXCEPTION 'Only BUY advertisements are eligible for content edits.' USING ERRCODE = '23514';
  END IF;
  IF p_patch ? 'direction' THEN v_direction := 'BUY'; END IF;

  v_current_price := coalesce(v_p2p_price, v_legacy_price);
  v_current_min := coalesce(v_p2p_min, v_legacy_min);
  v_current_max := coalesce(v_p2p_max, v_legacy_max);
  v_asset := pg_catalog.upper(pg_catalog.btrim(coalesce(p_patch->>'asset_symbol', v_p2p_asset, v_legacy_asset, 'USDT')));
  v_fiat := pg_catalog.upper(pg_catalog.btrim(coalesce(p_patch->>'fiat_symbol', v_p2p_fiat, v_legacy_fiat, 'USD')));
  v_current_price := coalesce((p_patch->>'price')::numeric, v_current_price);
  v_current_min := coalesce((p_patch->>'min_limit')::numeric, v_current_min);
  v_current_max := coalesce((p_patch->>'max_limit')::numeric, v_current_max);

  IF v_current_price IS NULL OR v_current_price <= 0 OR v_current_price >= 1000000000000000000
     OR v_current_min IS NULL OR v_current_min <= 0 OR v_current_min >= 1000000000000000000
     OR v_current_max IS NULL OR v_current_max < v_current_min OR v_current_max >= 1000000000000000000 THEN
    RAISE EXCEPTION 'The resulting advertisement price and trade limits are invalid.' USING ERRCODE = '22023';
  END IF;
  IF v_asset !~ '^[A-Z0-9]{2,12}$' OR v_fiat !~ '^[A-Z0-9]{3,12}$' THEN
    RAISE EXCEPTION 'Advertisement asset or fiat symbol is invalid.' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'payment_methods' THEN
    v_methods := p_patch->'payment_methods';
  ELSIF v_p2p_methods IS NOT NULL AND pg_catalog.jsonb_typeof(v_p2p_methods) = 'array' AND pg_catalog.jsonb_array_length(v_p2p_methods) > 0 THEN
    v_methods := v_p2p_methods;
  ELSIF v_p2p_methods IS NOT NULL AND pg_catalog.jsonb_typeof(v_p2p_methods) = 'string' THEN
    v_methods := pg_catalog.to_jsonb(pg_catalog.string_to_array(v_p2p_methods #>> '{}', ','));
  ELSIF v_p2p_payment_method IS NOT NULL AND pg_catalog.btrim(v_p2p_payment_method) <> '' THEN
    v_methods := pg_catalog.to_jsonb(pg_catalog.string_to_array(v_p2p_payment_method, ','));
  ELSIF v_legacy_methods IS NOT NULL THEN
    v_methods := pg_catalog.to_jsonb(v_legacy_methods);
  ELSE
    v_methods := pg_catalog.jsonb_build_array('Bank Transfer');
  END IF;
  SELECT coalesce(
           pg_catalog.array_agg(pg_catalog.btrim(entry.value) ORDER BY entry.ordinality),
           ARRAY[]::text[]
         )
    INTO v_method_array
    FROM pg_catalog.jsonb_array_elements_text(v_methods)
         WITH ORDINALITY AS entry(value, ordinality);
  IF cardinality(v_method_array) < 1 OR cardinality(v_method_array) > 20
     OR EXISTS (SELECT 1 FROM pg_catalog.unnest(v_method_array) AS method(value)
                 WHERE method.value IS NULL OR pg_catalog.btrim(method.value) = '') THEN
    RAISE EXCEPTION 'Advertisement must have between one and twenty non-empty payment methods.' USING ERRCODE = '22023';
  END IF;
  v_methods := pg_catalog.to_jsonb(v_method_array);

  IF p_patch ? 'terms' THEN v_terms := p_patch->>'terms';
  ELSE v_terms := coalesce(v_p2p_terms, v_legacy_terms, '');
  END IF;

  IF p_patch ? 'pricing_type' THEN v_pricing_type := pg_catalog.upper(p_patch->>'pricing_type');
  ELSE v_pricing_type := pg_catalog.upper(coalesce(v_p2p_pricing, v_legacy_pricing, 'FLOAT'));
  END IF;
  IF v_pricing_type NOT IN ('FIXED','FLOAT') THEN v_pricing_type := 'FLOAT'; END IF;
  IF p_patch ? 'margin' THEN v_margin := (p_patch->>'margin')::numeric;
  ELSE v_margin := coalesce(v_p2p_margin, v_legacy_margin, 0);
  END IF;
  v_min_completed_trades := coalesce(
    (p_patch->>'min_completed_trades')::integer,
    (SELECT a.min_completed_trades_req FROM public.p2p_ads AS a WHERE a.id = p_p2p_ad_id),
    (SELECT a.min_completed_trades FROM public.ads AS a WHERE a.id = p_legacy_ad_id),
    0
  );
  v_payment_window := coalesce((p_patch->>'payment_window')::integer,
    (SELECT a.payment_window FROM public.ads AS a WHERE a.id = p_legacy_ad_id),
    30);
  IF v_min_completed_trades < 0 OR v_min_completed_trades > 1000000 THEN
    RAISE EXCEPTION 'Existing minimum completed trades value is outside the supported range.' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'margin' OR v_pricing_type = 'FLOAT' THEN
    IF v_margin < -50 OR v_margin > 50 THEN
      RAISE EXCEPTION 'Effective pricing margin must be between -50 and +50.' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_changed_fields := ARRAY(SELECT pg_catalog.jsonb_object_keys(p_patch) ORDER BY 1);

  IF p_p2p_ad_id IS NOT NULL THEN
    UPDATE public.p2p_ads
       SET price = v_current_price,
           min_limit = v_current_min,
           max_limit = v_current_max,
           asset_symbol = v_asset,
           crypto_currency = v_asset,
           coin = v_asset,
           fiat_symbol = v_fiat,
           fiat_currency = v_fiat,
           payment_methods = v_methods,
           payment_method = pg_catalog.array_to_string(v_method_array, ', '),
           terms = v_terms,
           pricing_type = v_pricing_type,
           margin = v_margin,
           ad_type = v_direction,
           type = v_direction,
           min_completed_trades_req = v_min_completed_trades
     WHERE id = p_p2p_ad_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Canonical advertisement content update did not affect a row.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF p_legacy_ad_id IS NOT NULL THEN
    UPDATE public.ads
       SET price = v_current_price,
           unit_price = v_current_price,
           min_limit = v_current_min,
           min_amount = v_current_min,
           max_limit = v_current_max,
           max_amount = v_current_max,
           asset_symbol = v_asset,
           asset = v_asset,
           coin = v_asset,
           crypto_currency = v_asset,
           token_symbol = v_asset,
           fiat_symbol = v_fiat,
           fiat_currency = v_fiat,
           currency = v_fiat,
           payment_methods = v_method_array,
           terms = v_terms,
           pricing_type = v_pricing_type,
           price_type = v_pricing_type,
           rate_type = CASE WHEN v_pricing_type = 'FIXED' THEN 'fixed' ELSE 'market' END,
           is_fixed = (v_pricing_type = 'FIXED'),
           fixed_rate = CASE WHEN v_pricing_type = 'FIXED' THEN v_current_price ELSE NULL END,
           fixed_price = CASE WHEN v_pricing_type = 'FIXED' THEN v_current_price ELSE NULL END,
           margin = v_margin,
           margin_percentage = v_margin,
           rate_percent = v_margin,
           rate_adjustment = v_margin,
           price_margin = v_margin,
           margin_rate = v_margin,
           trade_type = v_direction,
           type = v_direction,
           payment_window = CASE WHEN p_patch ? 'payment_window' THEN v_payment_window ELSE payment_window END,
           payment_window_minutes = CASE WHEN p_patch ? 'payment_window' THEN v_payment_window ELSE payment_window_minutes END,
           payment_time_limit = CASE WHEN p_patch ? 'payment_window' THEN v_payment_window ELSE payment_time_limit END,
           tags = CASE WHEN p_patch ? 'tags' THEN ARRAY(SELECT pg_catalog.jsonb_array_elements_text(p_patch->'tags')) ELSE tags END,
           ad_tags = CASE WHEN p_patch ? 'tags' THEN ARRAY(SELECT pg_catalog.jsonb_array_elements_text(p_patch->'tags')) ELSE ad_tags END,
           targeted_countries = CASE WHEN p_patch ? 'targeted_countries' THEN ARRAY(SELECT pg_catalog.upper(country.value) FROM pg_catalog.jsonb_array_elements_text(p_patch->'targeted_countries') AS country(value)) ELSE targeted_countries END,
           blocked_countries = CASE WHEN p_patch ? 'blocked_countries' THEN ARRAY(SELECT pg_catalog.upper(country.value) FROM pg_catalog.jsonb_array_elements_text(p_patch->'blocked_countries') AS country(value)) ELSE blocked_countries END,
           offer_label = CASE WHEN p_patch ? 'offer_label' THEN p_patch->>'offer_label' ELSE offer_label END,
           label = CASE WHEN p_patch ? 'offer_label' THEN p_patch->>'offer_label' ELSE label END,
           require_full_name_verified = CASE WHEN p_patch ? 'require_full_name_verified' THEN (p_patch->>'require_full_name_verified')::boolean ELSE require_full_name_verified END,
           require_verified_users = CASE WHEN p_patch ? 'require_verified_users' THEN (p_patch->>'require_verified_users')::boolean ELSE require_verified_users END,
           min_completed_trades = v_min_completed_trades,
           min_trade_count = v_min_completed_trades,
           auto_reply = CASE WHEN p_patch ? 'auto_reply' THEN p_patch->>'auto_reply' ELSE auto_reply END,
           updated_at = pg_catalog.clock_timestamp()
     WHERE id = p_legacy_ad_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Legacy advertisement mirror content update did not affect a row.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF v_is_admin THEN
    INSERT INTO public.admin_audit_logs (
      admin_id, admin_email, action, target_id, target_user_id, details, created_at
    ) VALUES (
      p_actor_id,
      v_actor_email,
      'ADMIN_AD_CONTENT_EDIT',
      coalesce(p_p2p_ad_id::text, p_legacy_ad_id),
      v_owner_id,
      pg_catalog.jsonb_build_object(
        'p2p_ad_id', p_p2p_ad_id,
        'legacy_ad_id', p_legacy_ad_id,
        'changed_fields', pg_catalog.to_jsonb(v_changed_fields),
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
    'canonical_updated', p_p2p_ad_id IS NOT NULL,
    'legacy_updated', p_legacy_ad_id IS NOT NULL,
    'audit_logged', v_is_admin,
    'changed_fields', pg_catalog.to_jsonb(v_changed_fields),
    'price', v_current_price,
    'min_limit', v_current_min,
    'max_limit', v_current_max
  );
END;
$function$;

ALTER FUNCTION public.update_ad_content_atomic_authorized(uuid,text,uuid,text,jsonb) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.update_ad_content_atomic_authorized(uuid,text,uuid,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.update_ad_content_atomic_authorized(uuid,text,uuid,text,jsonb)
  TO service_role, postgres;

COMMENT ON FUNCTION public.update_ad_content_atomic_authorized(uuid,text,uuid,text,jsonb) IS
  'Atomic owner/full-admin BUY-ad content edit. Locks canonical and legacy rows in fixed order, verifies paired identity and owner, preserves status/inventory, updates canonical and legacy content in one transaction, and audits admin edits in that transaction.';

NOTIFY pgrst, 'reload schema';
COMMIT;
