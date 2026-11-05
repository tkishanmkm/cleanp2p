-- Restrict marketplace row writes to the verified server RPC/API layer.
-- Public/owner reads remain available; clients cannot directly insert, mutate,
-- truncate, or attach triggers to canonical marketplace records.
BEGIN;

ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access for ads" ON public.ads;
DROP POLICY IF EXISTS "Authenticated users can create own ads" ON public.ads;
DROP POLICY IF EXISTS ads_public_active_read ON public.ads;
DROP POLICY IF EXISTS ads_owner_read ON public.ads;

CREATE POLICY ads_public_active_read
    ON public.ads
    FOR SELECT
    TO anon, authenticated
    USING (
        COALESCE(active, FALSE) IS TRUE
        AND COALESCE(is_active, FALSE) IS TRUE
        AND COALESCE(is_deleted, FALSE) IS FALSE
        AND pg_catalog.lower(pg_catalog.btrim(COALESCE(status, ''))) = 'active'
    );

CREATE POLICY ads_owner_read
    ON public.ads
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Active ads are viewable by everyone" ON public.p2p_ads;
DROP POLICY IF EXISTS "Users can create ads" ON public.p2p_ads;
DROP POLICY IF EXISTS p2p_ads_public_active_read ON public.p2p_ads;
DROP POLICY IF EXISTS p2p_ads_owner_read ON public.p2p_ads;

CREATE POLICY p2p_ads_public_active_read
    ON public.p2p_ads
    FOR SELECT
    TO anon, authenticated
    USING (
        COALESCE(active, FALSE) IS TRUE
        AND COALESCE(is_active, FALSE) IS TRUE
        AND COALESCE(is_deleted, FALSE) IS FALSE
        AND pg_catalog.upper(pg_catalog.btrim(COALESCE(status, ''))) = 'ACTIVE'
    );

CREATE POLICY p2p_ads_owner_read
    ON public.p2p_ads
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can manage their own p2p orders" ON public.p2p_orders;

-- Retain SELECT only for the canonical public ad feeds. All DML and powerful
-- table privileges are service-role/server-side only. SECURITY DEFINER
-- create_buy_ad_atomic runs as its postgres owner and remains callable by
-- authenticated users through its narrow validated RPC interface.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.ads, public.p2p_ads
    FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.ads, public.p2p_ads
    TO anon, authenticated;

-- The abandoned p2p_orders order book is retired. No frontend route consumes it;
-- its replacement is ads/p2p_ads plus initiate_trade_with_escrow.
REVOKE ALL PRIVILEGES ON TABLE public.p2p_orders
    FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.ads IS
    'Canonical marketplace advertisements. Client reads are RLS-filtered; all writes use verified server routes and create_buy_ad_atomic.';

COMMENT ON TABLE public.p2p_ads IS
    'Compatibility marketplace mirror. Client reads are RLS-filtered; direct client DML is disabled.';

COMMENT ON TABLE public.p2p_orders IS
    'Legacy order-book table retired in favor of canonical ads/p2p_ads and escrow-backed trade creation.';

COMMIT;
