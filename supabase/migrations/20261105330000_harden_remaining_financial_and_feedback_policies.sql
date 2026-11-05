-- Close remaining browser-side financial writes and strengthen trade feedback RLS.
-- Preserve user-owned session/security/chat workflows and all service-role RPC writes.
BEGIN;

-- TRUNCATE bypasses RLS. Browser roles never need schema-level table/trigger
-- privileges, so remove these from every public base table.
REVOKE TRUNCATE, REFERENCES, TRIGGER
    ON ALL TABLES IN SCHEMA public
    FROM PUBLIC, anon, authenticated;

-- A transfer can be created only through execute_internal_transfer, which
-- performs balance locks, fee calculation, ledger writes and idempotency.
DROP POLICY IF EXISTS "Users can insert transfers as sender" ON public.transfers;
REVOKE INSERT, UPDATE, DELETE
    ON TABLE public.transfers
    FROM PUBLIC, anon, authenticated;

-- Disputes must be opened through raise_trade_dispute, which checks the
-- participant and trade state under the database transaction.
DROP POLICY IF EXISTS "Allow trade participants to insert disputes" ON public.disputes;
REVOKE INSERT, UPDATE, DELETE
    ON TABLE public.disputes
    FROM PUBLIC, anon, authenticated;

-- Feedback is written by the verified server route using the service client.
-- Do not allow browser clients to create/update legacy feedback records directly.
DROP POLICY IF EXISTS "Authenticated users can insert feedback for their trades" ON public.feedback;
DROP POLICY IF EXISTS "Users can update their own feedback" ON public.feedback;
REVOKE INSERT, UPDATE, DELETE
    ON TABLE public.feedback
    FROM PUBLIC, anon, authenticated;

-- One trade can receive one review from each participant. The earlier
-- UNIQUE(trade_id) constraint incorrectly prevented reciprocal reviews.
DO $feedback_preflight$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.feedbacks
        WHERE reviewer_id IS NULL OR reviewee_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot migrate feedbacks: existing reviewer/reviewee identities are incomplete.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.feedbacks
        GROUP BY trade_id, reviewer_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot migrate feedbacks: duplicate reviewer/trade rows require reconciliation.';
    END IF;
END;
$feedback_preflight$;

ALTER TABLE public.feedbacks
    DROP CONSTRAINT IF EXISTS feedbacks_trade_id_key;

ALTER TABLE public.feedbacks
    ADD CONSTRAINT feedbacks_trade_reviewer_unique UNIQUE (trade_id, reviewer_id);

-- The active feedback endpoint writes to feedbacks. Enforce completion, both
-- participant identities, and the exact counterparty at the row boundary.
DROP POLICY IF EXISTS "Users can insert feedback for their own trades" ON public.feedbacks;
DROP POLICY IF EXISTS "Users can update their own feedback" ON public.feedbacks;

CREATE POLICY feedbacks_insert_completed_trade_counterparty
    ON public.feedbacks
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND reviewer_id = (SELECT auth.uid())
        AND reviewee_id IS NOT NULL
        AND reviewer_id <> reviewee_id
        AND EXISTS (
            SELECT 1
            FROM public.trades AS t
            WHERE t.id = feedbacks.trade_id
              AND (
                  pg_catalog.upper(pg_catalog.btrim(COALESCE(t.status::text, ''))) IN ('COMPLETED', 'RELEASED')
                  OR pg_catalog.upper(pg_catalog.btrim(COALESCE(t.escrow_status::text, ''))) IN ('COMPLETED', 'RELEASED')
                  OR t.completed_at IS NOT NULL
                  OR t.released_at IS NOT NULL
              )
              AND (
                  (
                      t.buyer_id::text = (SELECT auth.uid())::text
                      AND t.seller_id::text = feedbacks.reviewee_id::text
                  )
                  OR
                  (
                      t.seller_id::text = (SELECT auth.uid())::text
                      AND t.buyer_id::text = feedbacks.reviewee_id::text
                  )
              )
        )
    );

-- The authenticated feedback API submits through the caller's Supabase session.
-- Grant INSERT only; the policy above verifies the exact completed trade and
-- counterparty. Updates/deletes remain prohibited.
GRANT INSERT ON TABLE public.feedbacks TO authenticated;

REVOKE UPDATE, DELETE
    ON TABLE public.feedbacks
    FROM PUBLIC, anon, authenticated;

-- Reputation counters are derived from canonical feedback rows. Update the
-- profile as part of the same transaction as feedback insertion so the row and
-- its aggregate cannot diverge after a partial API failure.
CREATE OR REPLACE FUNCTION public.recalculate_feedback_reputation_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_positive integer;
    v_negative integer;
    v_total integer;
    v_score integer;
BEGIN
    IF NEW.reviewee_id IS NULL THEN
        RAISE EXCEPTION 'Feedback recipient is required.'
            USING ERRCODE = '23502';
    END IF;

    SELECT
        count(*) FILTER (WHERE f.is_positive IS TRUE)::integer,
        count(*) FILTER (WHERE f.is_positive IS FALSE)::integer
    INTO v_positive, v_negative
    FROM public.feedbacks AS f
    WHERE f.reviewee_id = NEW.reviewee_id;

    v_total := coalesce(v_positive, 0) + coalesce(v_negative, 0);
    v_score := CASE
        WHEN v_total > 0 THEN round((100.0 * v_positive / v_total))::integer
        ELSE 100
    END;

    UPDATE public.profiles
    SET positive_feedback = coalesce(v_positive, 0),
        negative_feedback = coalesce(v_negative, 0),
        feedback_score = v_score,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = NEW.reviewee_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Feedback recipient profile is missing.'
            USING ERRCODE = '23503';
    END IF;

    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.recalculate_feedback_reputation_after_insert() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.recalculate_feedback_reputation_after_insert()
    FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS feedbacks_recalculate_reputation_after_insert ON public.feedbacks;
CREATE TRIGGER feedbacks_recalculate_reputation_after_insert
    AFTER INSERT ON public.feedbacks
    FOR EACH ROW
    EXECUTE FUNCTION public.recalculate_feedback_reputation_after_insert();

-- This legacy table has no application readers or writers. Retain the data for
-- audit/history, but withdraw direct access until it is formally migrated.
DROP POLICY IF EXISTS "Users can manage their user_feedbacks" ON public.user_feedbacks;
REVOKE ALL PRIVILEGES
    ON TABLE public.user_feedbacks
    FROM PUBLIC, anon, authenticated;

-- The following tables are exclusively managed by SECURITY DEFINER RPCs,
-- workers or verified server clients. Remove browser DML while preserving any
-- pre-existing RLS-filtered SELECT policies for history/config where needed.
REVOKE INSERT, UPDATE, DELETE
    ON TABLE
        public.address_derivation_counters,
        public.admin_main_wallets,
        public.admin_user_status_snapshots,
        public.app_admins,
        public.app_settings,
        public.crypto_market_prices,
        public.deposit_address_nonces,
        public.deposit_addresses,
        public.deposits,
        public.financial_idempotency_keys,
        public.financial_ledger,
        public.gas_funding_operations,
        public.hot_wallet_config,
        public.hot_wallet_nonces,
        public.hot_wallet_withdrawals,
        public.internal_transfers,
        public.ledger_entries,
        public.legacy_balances_archive,
        public.legacy_wallet_assets_archive,
        public.onchain_deposits,
        public.platform_ledger_entries,
        public.platform_settings,
        public.resource_delegation_operations,
        public.sweep_logs,
        public.sweep_operations,
        public.sweep_queue,
        public.user_balances,
        public.user_deposit_addresses,
        public.utxo_reservations,
        public.wallet_balances,
        public.wallet_transactions,
        public.webhook_events,
        public.withdrawal_limits
    FROM PUBLIC, anon, authenticated;

-- Aggregate financial totals must never be exposed as a public/authenticated
-- view; the admin dashboard reads these values through its verified server API.
REVOKE ALL PRIVILEGES
    ON TABLE public.admin_financial_overview
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_financial_overview TO service_role;

-- Cross-account summary views are not consumed by the current application.
-- Restrict them until a future API exposes a deliberately scoped response.
REVOKE ALL PRIVILEGES
    ON TABLE public.user_trading_stats, public.wallet_balances_view
    FROM PUBLIC, anon, authenticated;

COMMIT;
