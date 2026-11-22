BEGIN;

-- Patch the deployed SECURITY DEFINER function in-place only when its expected
-- structure matches. This migration intentionally fails closed on drift.
DO $migration$
DECLARE
  v_signature regprocedure := to_regprocedure('public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)');
  v_definition text;
  v_patched text;
  v_old text;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'Expected public.request_withdrawal signature was not found.';
  END IF;

  v_definition := pg_get_functiondef(v_signature);
  v_patched := v_definition;

  IF position('v_is_banned BOOLEAN := FALSE;' in v_patched) = 0
     OR position('IF v_is_banned OR v_is_on_hold OR v_is_withdrawal_locked OR v_account_status IN (''restricted'', ''frozen'', ''banned'') THEN' in v_patched) = 0
     OR position('account_status = ''restricted''' in v_patched) = 0 THEN
    RAISE EXCEPTION 'request_withdrawal definition drifted; manual reconciliation is required.';
  END IF;

  v_patched := replace(
    v_patched,
    'v_is_banned BOOLEAN := FALSE;',
    'v_is_banned BOOLEAN := FALSE; v_is_restricted BOOLEAN := FALSE; v_is_suspended BOOLEAN := FALSE; v_profile_status TEXT;'
  );

  v_old := '    -- CRITICAL STEP 1.1: AUTHORITATIVE INDIVIDUAL EMERGENCY FREEZE CHECK';
  v_patched := replace(
    v_patched,
    v_old,
    '    SELECT COALESCE(is_restricted, FALSE), COALESCE(is_suspended, FALSE), status' || chr(10) ||
    '    INTO v_is_restricted, v_is_suspended, v_profile_status' || chr(10) ||
    '    FROM public.profiles WHERE id = p_user_id;' || chr(10) || chr(10) ||
    v_old
  );

  v_patched := replace(
    v_patched,
    'IF v_is_banned OR v_is_on_hold OR v_is_withdrawal_locked OR v_account_status IN (''restricted'', ''frozen'', ''banned'') THEN',
    'IF v_is_banned OR v_is_restricted OR v_is_suspended OR v_is_on_hold OR v_is_withdrawal_locked ' ||
    'OR LOWER(COALESCE(v_profile_status, '''')) IN (''banned'', ''restricted'', ''suspended'', ''deleted'', ''on_hold'', ''hold'') ' ||
    'OR UPPER(COALESCE(v_account_status, '''')) IN (''RESTRICTED'', ''FROZEN'', ''BANNED'', ''BLOCKED'', ''SUSPENDED'', ''ON_HOLD'', ''HOLD'', ''DELETION_PENDING'', ''DELETED'') THEN'
  );

  v_patched := regexp_replace(
    v_patched,
    'SET account_status = ''restricted'',[[:space:]]*is_withdrawal_locked = true,[[:space:]]*updated_at = NOW\(\)',
    'SET is_restricted = true, status = ''restricted'', is_withdrawal_locked = true, updated_at = NOW()',
    'g'
  );

  v_old := '    -- Authoritative USD Equivalent (Server-provided or pegged fallback)';
  v_patched := replace(
    v_patched,
    v_old,
    '    -- The service-role API must supply a fresh, authoritative USD equivalent.' || chr(10) ||
    '    IF p_usd_equivalent IS NULL OR p_usd_equivalent <= 0 THEN' || chr(10) ||
    '        RAISE EXCEPTION ''Authoritative USD equivalent required for withdrawal.'' USING ERRCODE = ''22023'';' || chr(10) ||
    '    END IF;' || chr(10) ||
    '    v_effective_usd := p_usd_equivalent;' || chr(10) ||
    '    IF v_effective_usd < 5 THEN' || chr(10) ||
    '        RAISE EXCEPTION ''MIN_WITHDRAWAL_USD_NOT_MET: Minimum withdrawal is $5 USD equivalent.'' USING ERRCODE = ''22023'';' || chr(10) ||
    '    END IF;' || chr(10)
  );

  IF v_patched = v_definition
     OR position('account_status = ''restricted''' in v_patched) > 0
     OR position('v_is_restricted OR v_is_suspended' in v_patched) = 0
     OR position('MIN_WITHDRAWAL_USD_NOT_MET' in v_patched) = 0 THEN
    RAISE EXCEPTION 'request_withdrawal hardening did not apply completely; refusing partial migration.';
  END IF;

  -- Harden the SECURITY DEFINER execution context; object references in this
  -- function are schema-qualified and built-ins resolve from pg_catalog.
  v_patched := replace(v_patched, 'SET search_path TO ''public'', ''auth'', ''pg_temp''', 'SET search_path = ''''');

  EXECUTE v_patched;
END;
$migration$;

COMMIT;
