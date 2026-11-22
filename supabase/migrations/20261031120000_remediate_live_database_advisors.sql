-- Reconcile live advisor findings against the actual authorization model.
-- Changes are limited to redundant policies/indexes, real missing FK indexes,
-- and a platform-ledger policy that previously trusted editable user metadata.
BEGIN;

-- This policy granted no rows and is unnecessary: RLS denies access by default.
DROP POLICY IF EXISTS "No public access" ON public.admin_audit_logs;
DROP POLICY IF EXISTS "No public access" ON public.hot_wallet_config;
ALTER POLICY "Admins can view audit logs"
    ON public.admin_audit_logs TO authenticated
    USING ((SELECT public.is_admin()));

-- Remove exact duplicate/subset policies while preserving the broader effective
-- access predicate on each table.
DROP POLICY IF EXISTS "admin_user_status_snapshots_select_policy" ON public.admin_user_status_snapshots;
ALTER POLICY "admin_user_status_snapshots_mutate_policy"
    ON public.admin_user_status_snapshots
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Users can view their own deposit addresses" ON public.deposit_addresses;
ALTER POLICY "Users view their own deposit addresses"
    ON public.deposit_addresses TO authenticated
    USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can view disputes related to their trades" ON public.disputes;
ALTER POLICY "Allow participants and admins to view disputes"
    ON public.disputes TO authenticated
    USING (
        (opened_by_id::text = (SELECT auth.uid())::text)
        OR (opened_by::text = (SELECT auth.uid())::text)
        OR ((SELECT auth.uid())::text IN (
            SELECT t.buyer_id FROM public.trades t
            WHERE t.id::text = disputes.trade_id::text
            UNION
            SELECT t.seller_id FROM public.trades t
            WHERE t.id::text = disputes.trade_id::text
        ))
        OR (SELECT public.is_admin())
    );
ALTER POLICY "Allow trade participants to insert disputes"
    ON public.disputes TO authenticated
    WITH CHECK (
        (
            (SELECT auth.uid())::text = opened_by_id::text
            OR (SELECT auth.uid())::text = opened_by::text
        )
        AND (SELECT auth.uid())::text IN (
            SELECT t.buyer_id FROM public.trades t
            WHERE t.id::text = disputes.trade_id::text
            UNION
            SELECT t.seller_id FROM public.trades t
            WHERE t.id::text = disputes.trade_id::text
        )
    );

DROP POLICY IF EXISTS "Enable read for own feedback" ON public.feedback;
DROP POLICY IF EXISTS "Users can view their own KYC record" ON public.kyc_verifications;

-- Service-role clients bypass RLS. Authenticated users only need to read their own
-- balance row; no browser write or service-role policy is necessary.
DROP POLICY IF EXISTS "user_balances_all_admin" ON public.user_balances;
DROP POLICY IF EXISTS "user_balances_select_policy" ON public.user_balances;
CREATE POLICY "user_balances_select_policy"
    ON public.user_balances
    FOR SELECT
    TO authenticated
    USING (user_id = (SELECT auth.uid()));

-- Moderators and trade participants can read their participation record. Only
-- administrators can mutate moderator assignments.
DROP POLICY IF EXISTS "trade_moderator_participations_mutate" ON public.trade_moderator_participations;
DROP POLICY IF EXISTS "trade_moderator_participations_select" ON public.trade_moderator_participations;
CREATE POLICY "trade_moderator_participations_select"
    ON public.trade_moderator_participations
    FOR SELECT
    TO authenticated
    USING (
        (SELECT public.is_admin())
        OR EXISTS (
            SELECT 1 FROM public.trades t
            WHERE t.id = trade_moderator_participations.trade_id
              AND (t.buyer_id = (SELECT auth.uid())::text OR t.seller_id = (SELECT auth.uid())::text)
        )
    );
CREATE POLICY "trade_moderator_participations_insert"
    ON public.trade_moderator_participations
    FOR INSERT
    TO authenticated
    WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "trade_moderator_participations_update"
    ON public.trade_moderator_participations
    FOR UPDATE
    TO authenticated
    USING ((SELECT public.is_admin()))
    WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "trade_moderator_participations_delete"
    ON public.trade_moderator_participations
    FOR DELETE
    TO authenticated
    USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Users can view own block relationships" ON public.user_blocks;
ALTER POLICY "user_blocks_select_policy"
    ON public.user_blocks TO authenticated
    USING (
        (SELECT auth.uid()) IS NOT NULL
        AND (
            blocker_id = (SELECT auth.uid())
            OR blocked_id = (SELECT auth.uid())
            OR (SELECT public.is_admin())
        )
    );
ALTER POLICY "user_blocks_insert_policy"
    ON public.user_blocks TO authenticated
    WITH CHECK (
        (SELECT auth.uid()) IS NOT NULL
        AND (blocker_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
    );
ALTER POLICY "user_blocks_delete_policy"
    ON public.user_blocks TO authenticated
    USING (
        (SELECT auth.uid()) IS NOT NULL
        AND (blocker_id = (SELECT auth.uid()) OR (SELECT public.is_admin()))
    );

DROP POLICY IF EXISTS "Users can view their own withdrawals" ON public.withdrawals;
ALTER POLICY "Users view their own withdrawals"
    ON public.withdrawals TO authenticated
    USING (user_id = (SELECT auth.uid()));

-- Do not let user-editable authentication metadata grant access to platform financial records.
DROP POLICY IF EXISTS "Admins can view platform ledger" ON public.platform_ledger_entries;
CREATE POLICY "Admins can view platform ledger"
    ON public.platform_ledger_entries
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

-- This function only reads the emergency_mode row, which is now covered by the
-- narrow client SELECT policy. It does not need SECURITY DEFINER privileges.
ALTER FUNCTION public.get_emergency_mode() SECURITY INVOKER;

-- Convert per-row auth function evaluation into initPlan evaluation. Normalize
-- pg_get_expr's existing SELECT aliases first to avoid nesting SELECT wrappers.
DO $migration$
DECLARE
    v_policy record;
    v_using text;
    v_check text;
BEGIN
    FOR v_policy IN
        SELECT n.nspname, c.relname, p.polname,
               pg_get_expr(p.polqual, p.polrelid) AS using_expr,
               pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND (
              position('auth.uid()' IN COALESCE(pg_get_expr(p.polqual, p.polrelid), '')) > 0
              OR position('auth.role()' IN COALESCE(pg_get_expr(p.polqual, p.polrelid), '')) > 0
              OR position('auth.uid()' IN COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')) > 0
              OR position('auth.role()' IN COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')) > 0
          )
    LOOP
        v_using := v_policy.using_expr;
        v_check := v_policy.check_expr;

        IF v_using IS NOT NULL THEN
            v_using := replace(v_using, 'SELECT auth.uid() AS uid', 'auth.uid()');
            v_using := replace(v_using, 'SELECT auth.role() AS role', 'auth.role()');
            v_using := replace(v_using, 'auth.uid()', '(SELECT auth.uid())');
            v_using := replace(v_using, 'auth.role()', '(SELECT auth.role())');
        END IF;

        IF v_check IS NOT NULL THEN
            v_check := replace(v_check, 'SELECT auth.uid() AS uid', 'auth.uid()');
            v_check := replace(v_check, 'SELECT auth.role() AS role', 'auth.role()');
            v_check := replace(v_check, 'auth.uid()', '(SELECT auth.uid())');
            v_check := replace(v_check, 'auth.role()', '(SELECT auth.role())');
        END IF;

        IF v_using IS DISTINCT FROM v_policy.using_expr
           OR v_check IS DISTINCT FROM v_policy.check_expr THEN
            IF v_using IS NOT NULL AND v_check IS NOT NULL THEN
                EXECUTE format(
                    'ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
                    v_policy.polname, v_policy.nspname, v_policy.relname, v_using, v_check
                );
            ELSIF v_using IS NOT NULL THEN
                EXECUTE format(
                    'ALTER POLICY %I ON %I.%I USING (%s)',
                    v_policy.polname, v_policy.nspname, v_policy.relname, v_using
                );
            ELSIF v_check IS NOT NULL THEN
                EXECUTE format(
                    'ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
                    v_policy.polname, v_policy.nspname, v_policy.relname, v_check
                );
            END IF;
        END IF;
    END LOOP;
END;
$migration$;

-- Five FK columns had no leading-column index in the live catalog.
CREATE INDEX IF NOT EXISTS idx_deposits_user_id
    ON public.deposits (user_id);
CREATE INDEX IF NOT EXISTS idx_platform_ledger_entries_related_user_id
    ON public.platform_ledger_entries (related_user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_emergency_frozen_by
    ON public.profiles (emergency_frozen_by);
CREATE INDEX IF NOT EXISTS idx_sweep_queue_user_id
    ON public.sweep_queue (user_id);
CREATE INDEX IF NOT EXISTS idx_utxo_reservations_sweep_id
    ON public.utxo_reservations (sweep_id);

-- Remove only byte-for-byte duplicate indexes/constraints. Keep the names already
-- referenced by the deployed schema's primary/default unique constraints and the
-- idempotency index with observed scans.
ALTER TABLE public.admin_main_wallets
    DROP CONSTRAINT IF EXISTS uq_admin_main_wallets_currency;
ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS uq_profiles_wallet_index;
ALTER TABLE public.wallets
    DROP CONSTRAINT IF EXISTS unique_wallet_address;
DROP INDEX IF EXISTS public.idx_feedback_trade;
DROP INDEX IF EXISTS public.transfers_sender_id_idempotency_key_unique;

COMMIT;
