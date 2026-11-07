-- Read-only production preflight for the canonical atomic BUY advertisement RPC.
DO $preflight$
DECLARE
    v_rpc regprocedure := to_regprocedure(
        'public.create_buy_ad_atomic(text,text,text,numeric,numeric,numeric,text,numeric,text[],integer,text,text,text,text[],text[],text[],integer,boolean,boolean)'
    );
    v_definition text;
    v_required text[] := ARRAY[
        'public_id','public_ad_id','user_id','type','trade_type',
        'asset_symbol','asset','coin','crypto_currency','fiat_symbol',
        'fiat_currency','currency','price','unit_price','pricing_type',
        'price_type','rate_type','is_fixed','fixed_rate','fixed_price',
        'margin','margin_percentage','rate_percent','rate_adjustment',
        'min_amount','max_amount','min_limit','max_limit','total_amount',
        'available_amount','payment_methods','payment_window',
        'payment_window_minutes','terms','offer_label','label','auto_reply',
        'ad_tags','tags','targeted_countries','blocked_countries',
        'allowed_countries','min_completed_trades','min_trade_count',
        'require_full_name_verified','require_verified_users','require_kyc',
        'active','is_active','status','is_deleted','created_at','updated_at'
    ];
    v_column text;
    v_p2p_required text[] := ARRAY[
        'public_ad_id','user_id','ad_type','type','crypto_currency',
        'fiat_currency','asset_symbol','fiat_symbol','coin','price',
        'pricing_type','margin','min_limit','max_limit','payment_method',
        'payment_methods','terms','active','is_active','status',
        'is_deleted','created_at','min_completed_trades_req'
    ];
BEGIN
    IF v_rpc IS NULL THEN
        RAISE EXCEPTION 'Canonical create_buy_ad_atomic RPC is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=v_rpc
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
          AND p.prorettype='jsonb'::regtype
    ) THEN
        RAISE EXCEPTION 'Atomic BUY-ad RPC must be postgres-owned SECURITY DEFINER with empty search_path';
    END IF;

    IF pg_catalog.has_function_privilege('anon',v_rpc,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated',v_rpc,'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role',v_rpc,'EXECUTE')
       OR pg_catalog.has_function_privilege('supabase_auth_admin',v_rpc,'EXECUTE')
       OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            CROSS JOIN LATERAL pg_catalog.aclexplode(
                coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
            ) acl
            WHERE p.oid=v_rpc
              AND acl.grantee=0
              AND acl.privilege_type='EXECUTE'
       ) THEN
        RAISE EXCEPTION 'Atomic BUY-ad RPC must be executable only by authenticated users and postgres';
    END IF;

    FOREACH v_column IN ARRAY v_required LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='ads'
              AND column_name=v_column
        ) THEN
            RAISE EXCEPTION 'Required ads column is missing: %',v_column;
        END IF;
    END LOOP;

    FOREACH v_column IN ARRAY v_p2p_required LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='p2p_ads'
              AND column_name=v_column
        ) THEN
            RAISE EXCEPTION 'Required p2p_ads column is missing: %',v_column;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        WHERE c.oid='public.ads'::regclass
          AND c.relrowsecurity IS TRUE
          AND c.relforcerowsecurity IS FALSE
          AND pg_catalog.pg_get_userbyid(c.relowner)='postgres'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        WHERE c.oid='public.p2p_ads'::regclass
          AND c.relrowsecurity IS TRUE
          AND c.relforcerowsecurity IS FALSE
          AND pg_catalog.pg_get_userbyid(c.relowner)='postgres'
    ) THEN
        RAISE EXCEPTION 'Marketplace tables must remain postgres-owned with RLS enabled and FORCE RLS disabled';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i
        WHERE i.indrelid='public.ads'::regclass
          AND i.indisunique AND i.indisvalid
          AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%(public_id)%'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i
        WHERE i.indrelid='public.p2p_ads'::regclass
          AND i.indisunique AND i.indisvalid
          AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%(public_ad_id)%'
    ) THEN
        RAISE EXCEPTION 'Marketplace public-ID unique indexes are missing';
    END IF;

    IF to_regprocedure('public.generate_12_char_id()') IS NULL
       OR to_regprocedure('public.set_ad_public_id()') IS NULL
       OR NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_trigger t
            WHERE t.tgrelid='public.ads'::regclass
              AND t.tgname='trigger_set_ad_public_id'
              AND NOT t.tgisinternal
              AND t.tgenabled<>'D'
       ) THEN
        RAISE EXCEPTION 'Canonical ads ID generator or before-insert trigger is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.system_settings
        WHERE key='prevent_new_ads'
          AND jsonb_typeof(value)='boolean'
    ) OR NOT EXISTS (
        SELECT 1 FROM public.system_settings
        WHERE key='emergency_mode'
          AND jsonb_typeof(value)='boolean'
    ) OR NOT EXISTS (
        SELECT 1 FROM public.system_settings
        WHERE key='maintenance_mode'
          AND jsonb_typeof(value)='boolean'
    ) THEN
        RAISE EXCEPTION 'Required fail-closed platform ad-creation control rows are missing or malformed';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='crypto_market_prices'
          AND column_name='asset_symbol'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='crypto_market_prices'
          AND column_name='fiat_symbol'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='crypto_market_prices'
          AND column_name='price_in_fiat'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='crypto_market_prices'
          AND column_name='updated_at'
    ) THEN
        RAISE EXCEPTION 'Market-price lookup contract for fixed/floating BUY ads is missing';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_rpc) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'auth.uid()')=0
       OR pg_catalog.strpos(v_definition,'auth.role()')=0
       OR pg_catalog.strpos(v_definition,'public.crypto_market_prices')=0
       OR pg_catalog.strpos(v_definition,'public.system_settings')=0
       OR pg_catalog.strpos(v_definition,'FOR SHARE')=0
       OR pg_catalog.strpos(v_definition,'public.profiles')=0
       OR pg_catalog.strpos(v_definition,'public.ads')=0
       OR pg_catalog.strpos(v_definition,'public.p2p_ads')=0
       OR pg_catalog.strpos(v_definition,'PLATFORM_AD_CREATION_DISABLED')=0
       OR pg_catalog.strpos(v_definition,'ACCOUNT_AD_ACCESS_BLOCKED')=0
       OR pg_catalog.strpos(v_definition,'''BUY''')=0
       OR pg_catalog.strpos(v_definition,'SELL')=0 THEN
        RAISE EXCEPTION 'Atomic BUY-ad function is missing authenticated actor, market/control/account guards or dual-table transaction writes';
    END IF;
END;
$preflight$;
