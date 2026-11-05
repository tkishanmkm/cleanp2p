-- Paxones: least-privilege PostgREST table grants for user-facing data.
-- Financial writes must go through authenticated server routes and guarded RPCs.
-- Preserve service_role privileges and the existing row-level read policies.

BEGIN;

-- Legacy transfer-history table: users may read rows where they are sender
-- or recipient, but cannot forge a transfer record from the browser.
DROP POLICY IF EXISTS "Users can insert transfers as sender" ON public.transfers;
REVOKE ALL ON TABLE public.transfers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.transfers TO authenticated;

-- Legacy p2p_trades records are read-only to participants. Financial state
-- transitions are performed through the canonical trades/escrow RPCs.
DROP POLICY IF EXISTS "Users can update their own trades" ON public.p2p_trades;
REVOKE ALL ON TABLE public.p2p_trades FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.p2p_trades TO authenticated;

-- Wallet/balance surfaces are read-only for users; service_role retains write access.
REVOKE ALL ON TABLE public.wallet_assets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.wallet_assets TO authenticated;

REVOKE ALL ON TABLE public.wallets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.wallets TO authenticated;

REVOKE ALL ON TABLE public.user_balances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_balances TO authenticated;

-- Deposit history is user-readable, but deposits can only be registered and
-- credited by the canonical service-role scanner/confirmation pipeline.
DROP POLICY IF EXISTS deposits_select_own ON public.deposits;
CREATE POLICY deposits_select_own
  ON public.deposits
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.deposits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.deposits TO authenticated;

REVOKE ALL ON TABLE public.onchain_deposits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.onchain_deposits TO authenticated;

-- Ledger details are not general user-facing tables. Platform ledger is
-- readable only to an authenticated administrator under its existing policy.
REVOKE ALL ON TABLE public.financial_ledger FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.platform_ledger_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.platform_ledger_entries TO authenticated;

-- KYC documents/status rows are visible only to the owning authenticated user;
-- inserts/updates are performed by the server and verified webhook handler.
REVOKE ALL ON TABLE public.kyc_verifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.kyc_verifications TO authenticated;

-- The application uses signed server-side B2 URLs and service-role metadata
-- writes. Users may read only metadata allowed by their existing owner policy.
REVOKE ALL ON TABLE public.trade_files FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.trade_files TO authenticated;

-- Older trade_attachments rows are participant-scoped. Allow participant
-- metadata inserts only; never allow client-side update/delete.
REVOKE ALL ON TABLE public.trade_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.trade_attachments TO authenticated;

-- Ads are public read surfaces. Authenticated users can create their own
-- records through the existing owner-checking INSERT policies; editing,
-- pausing, deleting and escrow-sensitive fields remain server-managed.
REVOKE ALL ON TABLE public.ads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ads TO anon, authenticated;
GRANT INSERT ON TABLE public.ads TO authenticated;

-- p2p_ads is a public-read mirror of canonical public.ads. The authenticated
-- /api/p2p/ads route creates the canonical ads row and mirrors it with service
-- role; direct browser INSERT would create orphan ads that escrow cannot resolve.
DROP POLICY IF EXISTS "Users can create ads" ON public.p2p_ads;
REVOKE ALL ON TABLE public.p2p_ads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.p2p_ads TO anon, authenticated;

-- Merchant application status is user-readable; applications are submitted
-- through the authenticated server route and reviewed by administrators.
REVOKE ALL ON TABLE public.merchant_applications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.merchant_applications TO authenticated;

COMMIT;
