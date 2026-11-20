-- Remove browser-side table mutation privileges from financial ledgers.
-- Financial state transitions must use authenticated, narrowly scoped RPC/API paths.
BEGIN;

ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_trades ENABLE ROW LEVEL SECURITY;

-- The old p2p_trades order book has no active application consumers. Its
-- participant UPDATE policy permits arbitrary changes to status/amount fields,
-- so remove it and disable direct client access to the legacy table entirely.
-- The compatibility list route still reads participant-owned legacy rows.
-- Remove direct mutation, but preserve its owner/participant SELECT policy.
DROP POLICY IF EXISTS "Users can update their own trades" ON public.p2p_trades;

DO $p2p_trade_read_policy$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'p2p_trades'
          AND policyname = 'Users can view their own trades'
          AND cmd = 'SELECT'
          AND qual LIKE '%auth.uid%'
          AND qual LIKE '%buyer_id%'
          AND qual LIKE '%seller_id%'
    ) THEN
        RAISE EXCEPTION
            'Expected participant-scoped p2p_trades SELECT policy is missing; refusing to remove the compatibility read path';
    END IF;
END;
$p2p_trade_read_policy$;

REVOKE ALL PRIVILEGES ON TABLE public.trades
    FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.wallet_assets
    FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.wallets
    FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.user_wallets
    FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.p2p_trades
    FROM PUBLIC, anon, authenticated;

-- Preserve read-only views protected by existing owner/participant RLS policies.
GRANT SELECT ON TABLE public.trades,
    public.wallet_assets,
    public.wallets,
    public.user_wallets,
    public.p2p_trades
    TO authenticated;

-- No direct table writes are granted back. SECURITY DEFINER settlement RPCs
-- owned by postgres and trusted server-role operations continue to perform
-- canonical balance, escrow, ledger and trade-state mutations atomically.
COMMENT ON TABLE public.trades IS
    'Canonical P2P trades. Authenticated participants/admins may read under RLS; all writes are through verified settlement RPCs.';

COMMENT ON TABLE public.wallet_assets IS
    'Canonical wallet asset balances and escrow liabilities. Authenticated owners may read under RLS; all mutations are server/RPC-only.';

COMMENT ON TABLE public.wallets IS
    'Legacy wallet read model. Authenticated owners may read under RLS; all mutations are server/RPC-only.';

COMMENT ON TABLE public.user_wallets IS
    'Legacy wallet read model. Authenticated owners may read under RLS; all mutations are server/RPC-only.';

COMMENT ON TABLE public.p2p_trades IS
    'Legacy P2P compatibility read model. Authenticated participants may SELECT under RLS; direct browser DML is disabled and canonical trades/escrow RPCs remain authoritative.';

COMMIT;
