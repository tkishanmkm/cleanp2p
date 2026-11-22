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
DROP POLICY IF EXISTS "Users can update their own trades" ON public.p2p_trades;
DROP POLICY IF EXISTS "Users can view their own trades" ON public.p2p_trades;

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
    public.user_wallets
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
    'Retired legacy P2P trade table. Direct anon/authenticated access is disabled; canonical trades and escrow RPCs are authoritative.';

COMMIT;
