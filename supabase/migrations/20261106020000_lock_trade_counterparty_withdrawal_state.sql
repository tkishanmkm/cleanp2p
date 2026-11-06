-- Enforce withdrawal-approval lockout for BOTH participants in a new escrow trade.
-- Recheck only after deterministic profile row locks: request_withdrawal locks the
-- same profile row before writing its pending approval record. This serializes a
-- concurrent withdrawal reservation against trade creation.
BEGIN;

DO $patch_trade_rpc$
DECLARE
    v_signature regprocedure :=
        to_regprocedure('public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)');
    v_definition text;
    v_marker text := '    IF v_caller_frozen THEN';
    v_guard text :=
        '    -- Recheck withdrawal holds after locking both profiles.' || chr(10) ||
        '    -- request_withdrawal takes the same per-user profile lock before recording' || chr(10) ||
        '    -- PENDING_APPROVAL, so concurrent withdrawals and trade creation serialize.' || chr(10) ||
        '    IF public.has_pending_withdrawal_approval(v_effective_caller) THEN' || chr(10) ||
        '        RAISE EXCEPTION ''WITHDRAWAL_APPROVAL_PENDING: Your pending withdrawal must be reviewed before creating or joining another P2P trade.''' || chr(10) ||
        '            USING ERRCODE = ''P0001'', DETAIL = ''WITHDRAWAL_APPROVAL_PENDING'';' || chr(10) ||
        '    END IF;' || chr(10) || chr(10) ||
        '    IF v_ad_user_id IS DISTINCT FROM v_effective_caller' || chr(10) ||
        '       AND public.has_pending_withdrawal_approval(v_ad_user_id) THEN' || chr(10) ||
        '        RAISE EXCEPTION ''COUNTERPARTY_WITHDRAWAL_APPROVAL_PENDING: The other trade participant has a withdrawal awaiting administrator approval.''' || chr(10) ||
        '            USING ERRCODE = ''P0001'', DETAIL = ''COUNTERPARTY_WITHDRAWAL_APPROVAL_PENDING'';' || chr(10) ||
        '    END IF;' || chr(10) || chr(10);
BEGIN
    IF v_signature IS NULL THEN
        RAISE EXCEPTION 'Required canonical initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid) function is missing.';
    END IF;

    SELECT pg_get_functiondef(v_signature)
      INTO v_definition;

    IF v_definition IS NULL
       OR position(v_marker IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Canonical trade RPC does not contain the expected post-lock freeze guard; refusing to patch an unexpected function version.';
    END IF;

    IF (length(v_definition) - length(replace(v_definition, v_marker, ''))) <> length(v_marker) THEN
        RAISE EXCEPTION 'Expected exactly one post-lock caller freeze guard in canonical trade RPC.';
    END IF;

    IF position('COUNTERPARTY_WITHDRAWAL_APPROVAL_PENDING' IN v_definition) > 0 THEN
        RAISE EXCEPTION 'Counterparty withdrawal-approval guard already exists; refusing duplicate patch.';
    END IF;

    v_definition := replace(v_definition, v_marker, v_guard || v_marker);
    EXECUTE v_definition;
END;
$patch_trade_rpc$;

-- These privileged helpers are called from SECURITY DEFINER financial RPCs.
-- Their table references are schema-qualified, so an empty search_path is safe
-- and prevents public/temporary objects from shadowing trusted names.
ALTER FUNCTION public.has_pending_withdrawal_approval(uuid) SET search_path = '';
ALTER FUNCTION public.get_user_kyc_tier(uuid) SET search_path = '';
ALTER FUNCTION public.get_user_cumulative_buy_volume(uuid) SET search_path = '';

-- Assert both caller and ad-owner checks are present after profile locking.
DO $verify$
DECLARE
    v_definition text;
    v_guard_position integer;
    v_caller_freeze_position integer;
BEGIN
    SELECT pg_get_functiondef(
        'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)'::regprocedure
    )
    INTO v_definition;

    v_guard_position := position('COUNTERPARTY_WITHDRAWAL_APPROVAL_PENDING' IN v_definition);
    v_caller_freeze_position := position('IF v_caller_frozen THEN' IN v_definition);

    IF v_guard_position = 0
       OR v_caller_freeze_position = 0
       OR v_guard_position >= v_caller_freeze_position THEN
        RAISE EXCEPTION 'Post-lock caller/counterparty withdrawal guards were not installed in the expected location.';
    END IF;

    IF position('public.has_pending_withdrawal_approval(v_effective_caller)' IN v_definition) = 0
       OR position('public.has_pending_withdrawal_approval(v_ad_user_id)' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Trade RPC must check pending withdrawal approval for both participants.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        WHERE p.oid = 'public.has_pending_withdrawal_approval(uuid)'::regprocedure
          AND p.prosecdef IS TRUE
          AND p.proconfig @> ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'has_pending_withdrawal_approval must retain SECURITY DEFINER and use an empty search_path.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        WHERE p.oid = 'public.get_user_kyc_tier(uuid)'::regprocedure
          AND p.prosecdef IS TRUE
          AND p.proconfig @> ARRAY['search_path=""']::text[]
    ) OR NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        WHERE p.oid = 'public.get_user_cumulative_buy_volume(uuid)'::regprocedure
          AND p.prosecdef IS TRUE
          AND p.proconfig @> ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'Nested KYC/volume SECURITY DEFINER helpers must use an empty search_path.';
    END IF;

    IF has_function_privilege('anon', 'public.has_pending_withdrawal_approval(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.has_pending_withdrawal_approval(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_user_kyc_tier(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.get_user_kyc_tier(uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.get_user_cumulative_buy_volume(uuid)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.get_user_cumulative_buy_volume(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'A privileged nested trade helper is executable by browser roles.';
    END IF;
END;
$verify$;

COMMIT;
