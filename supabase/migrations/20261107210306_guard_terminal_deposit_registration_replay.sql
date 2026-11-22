-- Keep ledger-backed deposits finalized when scanners replay zero-confirmation candidates.
-- A valid existing ledger entry is an idempotent ALREADY_CREDITED response.
-- A terminal tracking row without its ledger fails closed for reconciliation.
-- This function-body patch changes no wallet, deposit, or ledger rows by itself.
BEGIN;

DO $migration$
DECLARE
  v_signature REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)'
  );
  v_definition TEXT;
  v_ledger_section TEXT;
  v_ledger_section_pos INTEGER;
  v_marker TEXT := '    -- PENDING DEPOSIT';
  v_ledger_marker TEXT := '    IF v_ledger_count > 1 THEN';
  v_wallet_marker TEXT := $wallet_marker$
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'WALLET_ASSET_NOT_PROVISIONED',
            'asset', v_asset
        );
    END IF;
$wallet_marker$;
  v_wallet_guard TEXT := $wallet_guard$
    -- Never turn a corrupted/null wallet balance into a silent null credit.
    -- Require manual reconciliation before any deposit balance mutation.
    IF v_previous_balance IS NULL
       OR v_previous_balance < 0
       OR v_previous_balance::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'WALLET_ASSET_BALANCE_INVALID',
        'message', 'Wallet asset balance requires reconciliation; deposit credit was not applied',
        'asset', v_asset
      );
    END IF;

$wallet_guard$;
  v_guard TEXT := $guard$
    -- Scanner replay returned an existing credited deposit without changing balances.
    -- Return an idempotent success when its exact ledger identity is validated.
    IF NOT v_is_confirmed AND v_existing_deposit.id IS NOT NULL THEN
      SELECT COUNT(*)
      INTO v_ledger_count
      FROM public.ledger_entries
      WHERE reference_id = v_existing_deposit.id::TEXT;

      IF v_ledger_count > 1 THEN
        RAISE EXCEPTION
          'Multiple ledger entries found for deposit %',
          v_existing_deposit.id;
      END IF;

      IF v_ledger_count = 1 THEN
        SELECT *
        INTO v_existing_ledger
        FROM public.ledger_entries
        WHERE reference_id = v_existing_deposit.id::TEXT;

        IF v_existing_ledger.user_id IS DISTINCT FROM v_user_id
           OR v_existing_ledger.type IS DISTINCT FROM 'deposit'
           OR v_existing_ledger.amount IS DISTINCT FROM p_amount
           OR v_existing_ledger.crypto IS DISTINCT FROM v_asset
           OR v_existing_ledger.asset IS DISTINCT FROM v_asset THEN
          RAISE EXCEPTION
            'Existing ledger entry is inconsistent for deposit %',
            v_existing_deposit.id;
        END IF;

        RETURN jsonb_build_object(
          'success', true,
          'status', 'ALREADY_CREDITED',
          'credited', false,
          'already_credited', true,
          'deposit_id', v_existing_deposit.id,
          'onchain_deposit_id', v_existing_onchain.id,
          'ledger_id', v_existing_ledger.id,
          'user_id', v_user_id,
          'asset', v_asset,
          'network', v_network,
          'amount', p_amount,
          'confirmations', v_effective_confirmations,
          'required_confirmations', v_required_confirmations
        );
      END IF;
    END IF;

    -- A terminal tracking row with no matching ledger cannot be credited
    -- again automatically; require manual reconciliation instead.
    IF NOT v_is_confirmed AND (
      (v_existing_deposit.id IS NOT NULL
        AND upper(btrim(coalesce(v_existing_deposit.status, ''))) IN ('CONFIRMED', 'CREDITED'))
      OR
      (v_existing_onchain.id IS NOT NULL
        AND upper(btrim(coalesce(v_existing_onchain.status, ''))) IN ('CONFIRMED', 'CREDITED'))
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'credited', false,
        'code', 'DEPOSIT_STATE_INCONSISTENT',
        'message', 'Terminal deposit output has no matching ledger entry; manual reconciliation required'
      );
    END IF;

$guard$;
  v_ledger_guard TEXT := $ledger_guard$
    -- Terminal ledger invariant guard: a terminal row cannot be credited without its ledger.
    IF v_ledger_count = 0 AND (
      (v_existing_deposit.id IS NOT NULL
        AND upper(btrim(coalesce(v_existing_deposit.status, ''))) IN ('CONFIRMED', 'CREDITED'))
      OR
      (v_existing_onchain.id IS NOT NULL
        AND upper(btrim(coalesce(v_existing_onchain.status, ''))) IN ('CONFIRMED', 'CREDITED'))
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'credited', false,
        'code', 'DEPOSIT_STATE_INCONSISTENT',
        'message', 'Terminal deposit output has no matching ledger entry; manual reconciliation required'
      );
    END IF;

$ledger_guard$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'Canonical process_deposit_atomic signature is missing.';
  END IF;

  -- Re-assert the hardened path here instead of trusting an older migration's
  -- history row: the live function may have been replaced with a mutable path.
  EXECUTE 'ALTER FUNCTION public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text) SET search_path = pg_catalog';

  v_definition := pg_catalog.pg_get_functiondef(v_signature);

  -- A NULL, negative, or non-finite wallet balance is an integrity incident,
  -- not a value that a deposit may silently coerce or extend.
  IF pg_catalog.strpos(v_definition, 'WALLET_ASSET_BALANCE_INVALID') = 0 THEN
    IF pg_catalog.length(v_definition)
       - pg_catalog.length(pg_catalog.replace(v_definition, v_wallet_marker, ''))
       <> pg_catalog.length(v_wallet_marker) THEN
      RAISE EXCEPTION 'Unexpected canonical deposit RPC body: wallet balance guard marker is missing or ambiguous.';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_wallet_marker, v_wallet_marker || v_wallet_guard);
  END IF;

  IF pg_catalog.strpos(v_definition, 'v_ledger_count = 1') = 0
     OR pg_catalog.strpos(v_definition, 'reference_id = v_deposit_id::TEXT') = 0
     OR pg_catalog.strpos(v_definition, 'status = ''PENDING''') = 0
     OR pg_catalog.strpos(v_definition, 'INTO v_existing_deposit') = 0
     OR pg_catalog.strpos(v_definition, 'INTO v_existing_onchain') = 0 THEN
    RAISE EXCEPTION 'Canonical deposit RPC differs from the reviewed immutable-identity implementation.';
  END IF;

  -- Patch the pending branch once. The unique guard comment makes reruns safe.
  IF pg_catalog.strpos(v_definition, 'Scanner replay returned an existing credited deposit without changing balances') = 0 THEN
    IF pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_marker, '')) <> pg_catalog.length(v_marker) THEN
      RAISE EXCEPTION 'Unexpected canonical deposit RPC body: pending branch marker is not unique.';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_marker, v_guard || v_marker);
  END IF;

  -- Search only the canonical ledger section. The replay guard above contains
  -- its own count check, so a global marker count would incorrectly reject reruns.
  IF pg_catalog.strpos(v_definition, 'Terminal ledger invariant guard:') = 0 THEN
    v_ledger_section_pos := pg_catalog.strpos(v_definition, '-- LEDGER IDEMPOTENCY');
    IF v_ledger_section_pos = 0 THEN
      RAISE EXCEPTION 'Canonical ledger idempotency section is missing.';
    END IF;
    v_ledger_section := pg_catalog.substr(v_definition, v_ledger_section_pos);
    IF pg_catalog.length(v_ledger_section) - pg_catalog.length(pg_catalog.replace(v_ledger_section, v_ledger_marker, '')) <> pg_catalog.length(v_ledger_marker) THEN
      RAISE EXCEPTION 'Canonical ledger marker is missing or ambiguous.';
    END IF;
    v_ledger_section := pg_catalog.replace(v_ledger_section, v_ledger_marker, v_ledger_guard || v_ledger_marker);
    v_definition := pg_catalog.substr(v_definition, 1, v_ledger_section_pos - 1) || v_ledger_section;
  END IF;

  IF pg_catalog.strpos(v_definition, '''status'', ''ALREADY_CREDITED''') = 0
     OR pg_catalog.strpos(v_definition, '''already_credited'', true') = 0
     OR pg_catalog.strpos(v_definition, 'Terminal ledger invariant guard:') = 0 THEN
    RAISE EXCEPTION 'Deposit replay and terminal-state guard installation verification failed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_signature
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=pg_catalog']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'Canonical deposit RPC must already have the hardened pg_catalog search_path.';
  END IF;

  EXECUTE v_definition;
END;
$migration$;

COMMIT;
