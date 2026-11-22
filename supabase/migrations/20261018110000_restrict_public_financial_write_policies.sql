-- Restrict public/client table writes for ads and internal-transfer records.
-- Transfers must only be recorded by the trusted atomic transfer RPC; never by direct client inserts.
-- Prepared locally only. Review and validate on an isolated database before applying.
BEGIN;

-- Public ad browsing remains public, but anonymous roles must not retain write
-- privileges even if a future RLS policy is accidentally broadened.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.ads FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.p2p_ads FROM PUBLIC, anon;
GRANT INSERT ON TABLE public.ads TO authenticated, service_role;
GRANT INSERT ON TABLE public.p2p_ads TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can create ads" ON public.p2p_ads;
CREATE POLICY "Users can create ads"
    ON public.p2p_ads
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = (SELECT auth.uid()));

-- A sender-id RLS check is not enough to make a direct transfer-row insert safe:
-- clients could forge amount/fee/status/balance metadata. All transfer records must be
-- written by execute_internal_transfer (SECURITY DEFINER, executable only by service_role).
DROP POLICY IF EXISTS "Users can insert transfers as sender" ON public.transfers;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.transfers FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.transfers FROM authenticated;
GRANT SELECT ON TABLE public.transfers TO authenticated, service_role;
GRANT INSERT ON TABLE public.transfers TO service_role;

-- Replace legacy service-role policies assigned to PUBLIC with a role-scoped policy.
-- Their old predicates checked auth.role(), but role-scoping is clearer and avoids
-- permissive-policy warnings while preserving trusted backend writes.
DROP POLICY IF EXISTS "Enable all access for service role on transfers" ON public.transfers;
DROP POLICY IF EXISTS "Service role has full access to transfers" ON public.transfers;
DROP POLICY IF EXISTS "Service role can insert transfers" ON public.transfers;
CREATE POLICY "Service role can manage transfers"
    ON public.transfers
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Keep one authenticated participant-read policy rather than duplicate PUBLIC policies.
DROP POLICY IF EXISTS "Users can view own transfers" ON public.transfers;
DROP POLICY IF EXISTS "Users can view their own transfers" ON public.transfers;
DROP POLICY IF EXISTS "Users can view their sent and received transfers" ON public.transfers;
CREATE POLICY "Users can view their own transfers"
    ON public.transfers
    FOR SELECT
    TO authenticated
    USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

COMMIT;
