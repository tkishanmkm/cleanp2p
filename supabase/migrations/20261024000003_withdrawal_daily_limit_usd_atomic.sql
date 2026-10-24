-- Patch the deployed request_withdrawal definition in place instead of
-- replacing it with a stale repository copy. This preserves production-only
-- emergency controls and any other deployed security logic.
BEGIN;

-- The deployed request_withdrawal definition already writes USD valuation
-- metadata to onchain_withdrawals. Production schema inspection found that
-- column missing, which would make new withdrawal reservations fail at runtime.
-- The refund RPC also reads metadata from withdrawals when it must use the
-- fallback table, so both tables need the same column before the function patch.
ALTER TABLE public.onchain_withdrawals
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.withdrawals
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $migration$
DECLARE
    v_definition TEXT;
    v_old_declaration TEXT := 'v_rolling_24h_usd NUMERIC(18, 2) := 0;';
    v_new_declaration TEXT := 'v_rolling_24h_usd NUMERIC(18, 2) := 0;
    v_missing_usd_equivalent_count INTEGER := 0;';
    v_old_valuation TEXT := '    -- Authoritative USD Equivalent (Server-provided or pegged fallback)
    IF p_usd_equivalent IS NOT NULL AND p_usd_equivalent > 0 THEN
        v_effective_usd := p_usd_equivalent;
    ELSIF v_asset_clean = ''USDT'' THEN
        v_effective_usd := p_amount;
    ELSE
        v_effective_usd := p_amount;
    END IF;';
    v_new_valuation TEXT := '    -- Require a trustworthy USD equivalent for every non-USDT asset.
    IF p_usd_equivalent IS NOT NULL AND p_usd_equivalent > 0 THEN
        v_effective_usd := p_usd_equivalent;
    ELSIF v_asset_clean = ''USDT'' THEN
        v_effective_usd := p_amount;
    ELSE
        RAISE EXCEPTION ''USD_EQUIVALENT_REQUIRED: A verified USD-equivalent value is required for non-USDT withdrawals.'';
    END IF;';
    v_old_daily_check TEXT := '    SELECT COALESCE(SUM(amount), 0)
    INTO v_rolling_24h_usd
    FROM public.withdrawals
    WHERE user_id = p_user_id
      AND created_at >= NOW() - INTERVAL ''24 hours''
      AND status IN (''completed'', ''processing'', ''QUEUED'', ''PENDING_APPROVAL'', ''APPROVED'', ''approved'', ''pending'');

    IF (v_rolling_24h_usd + v_effective_usd) > v_daily_limit_usd THEN';
    v_new_daily_check TEXT := '    -- The profile row is already locked FOR UPDATE above. This serializes
    -- reservations for the same user before this limit is calculated.
    -- Sum USD-equivalent values and include active, broadcasted, ambiguous,
    -- and completed withdrawals in the rolling window.
    SELECT
        COALESCE(SUM(
            CASE
                WHEN NULLIF(ow.metadata ->> ''usd_equivalent'', '''') IS NOT NULL
                     AND (ow.metadata ->> ''usd_equivalent'')::NUMERIC > 0
                     AND (ow.metadata ->> ''usd_equivalent'')::NUMERIC < 1000000000000
                    THEN (ow.metadata ->> ''usd_equivalent'')::NUMERIC
                WHEN UPPER(w.asset_symbol) = ''USDT''
                    THEN w.amount
                ELSE NULL
            END
        ), 0),
        COUNT(*) FILTER (
            WHERE COALESCE(UPPER(w.asset_symbol), '''') <> ''USDT''
              AND (
                  NULLIF(ow.metadata ->> ''usd_equivalent'', '''') IS NULL
                  OR (ow.metadata ->> ''usd_equivalent'')::NUMERIC <= 0
                  OR (ow.metadata ->> ''usd_equivalent'')::NUMERIC >= 1000000000000
              )
        )
    INTO v_rolling_24h_usd, v_missing_usd_equivalent_count
    FROM public.withdrawals AS w
    LEFT JOIN public.onchain_withdrawals AS ow ON ow.id = w.id
    WHERE w.user_id = p_user_id
      AND w.created_at >= NOW() - INTERVAL ''24 hours''
      AND LOWER(w.status) IN (
          ''completed'', ''confirmed'', ''processing'', ''broadcasting'', ''broadcasted'',
          ''ambiguous_broadcast'', ''queued'', ''pending_approval'', ''approved'', ''pending''
      );

    IF v_missing_usd_equivalent_count > 0 THEN
        RAISE EXCEPTION ''DAILY_LIMIT_UNVERIFIABLE: Existing withdrawals are missing USD-equivalent values; manual reconciliation is required.'';
    END IF;

    IF (v_rolling_24h_usd + v_effective_usd) > v_daily_limit_usd THEN';
BEGIN
    SELECT pg_get_functiondef(
        to_regprocedure('public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)')
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'Expected public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric) to exist; refusing to create a replacement from a stale definition.';
    END IF;

    -- Normalize source line endings so exact, guarded replacements are stable.
    v_definition := replace(v_definition, E'\\r\\n', E'\\n');

    IF position(v_old_declaration IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Unexpected request_withdrawal declaration; migration stopped without changing the function.';
    END IF;
    v_definition := replace(v_definition, v_old_declaration, v_new_declaration);

    IF position(v_old_valuation IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Unexpected request_withdrawal USD valuation logic; migration stopped without changing the function.';
    END IF;
    v_definition := replace(v_definition, v_old_valuation, v_new_valuation);

    IF position(v_old_daily_check IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Unexpected request_withdrawal daily-limit logic; migration stopped without changing the function.';
    END IF;
    v_definition := replace(v_definition, v_old_daily_check, v_new_daily_check);

    EXECUTE v_definition;
END
$migration$;

REVOKE EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) TO service_role, postgres;

COMMIT;
