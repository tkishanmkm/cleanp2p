-- Prevent disabled accounts from receiving a successful idempotency replay response.
-- The installed escrow RPC has accumulated security fixes since the original migration.
-- Patch its live definition in-place instead of replacing it with a stale repository snapshot.
-- Prepared locally only; validate on a populated isolated PostgreSQL database before deployment.
BEGIN;

DO $migration$
DECLARE
    v_oid oid;
    v_definition text;
    v_marker text := '    -- 1.1 Strict Idempotency Key Validation';
    v_marker_position integer;
    v_marker_count integer;
    v_early_section text;
    v_guard text := $guard$
    -- Fail closed before the idempotency lookup: disabled or missing accounts cannot
    -- obtain a successful replay response from a previously-created trade.
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = v_effective_caller
          AND COALESCE(p.is_banned, false) = false
          AND COALESCE(p.is_restricted, false) = false
          AND COALESCE(p.is_suspended, false) = false
          AND COALESCE(p.is_minor_restricted, false) = false
          AND p.account_status IS NOT NULL
          AND LOWER(BTRIM(p.account_status)) = 'active'
          AND LOWER(COALESCE(p.status::text, '')) = 'active'
    ) THEN
        RAISE EXCEPTION 'Trade initiation is disabled for this account.'
            USING ERRCODE = '42501', DETAIL = 'TRADE_INITIATION_ACCOUNT_DISABLED';
    END IF;

$guard$;
    v_hardened text;
BEGIN
    v_oid := to_regprocedure(
        'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)'
    );

    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Required escrow initiation RPC is missing; refusing to apply account guard.';
    END IF;

    v_definition := pg_get_functiondef(v_oid);
    v_marker_count := (
        length(v_definition) - length(replace(v_definition, v_marker, ''))
    ) / length(v_marker);

    IF v_marker_count <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one idempotency marker in initiate_trade_with_escrow; refusing to patch.';
    END IF;

    v_marker_position := position(v_marker IN v_definition);
    v_early_section := substring(v_definition FROM 1 FOR v_marker_position - 1);

    -- Idempotent rerun: do not insert a duplicate guard.
    IF position('TRADE_INITIATION_ACCOUNT_DISABLED' IN v_early_section) > 0 THEN
        RETURN;
    END IF;

    v_hardened := replace(v_definition, v_marker, v_guard || v_marker);

    IF v_hardened = v_definition THEN
        RAISE EXCEPTION 'Account guard insertion failed; refusing to continue.';
    END IF;

    EXECUTE v_hardened;
END;
$migration$;

COMMIT;
