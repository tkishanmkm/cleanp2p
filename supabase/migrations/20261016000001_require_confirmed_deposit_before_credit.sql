-- Recreate the legacy deposit-credit RPC with fail-closed state and confirmation checks.
-- Also restrict execution to the trusted server role.
CREATE OR REPLACE FUNCTION public.process_confirmed_deposit(
    p_deposit_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deposit RECORD;
    v_wallet_id UUID;
    v_asset_code TEXT;
    v_amount NUMERIC(36, 18);
    v_user_id UUID;
    v_tx_hash TEXT;
    v_network TEXT;
    v_available NUMERIC(36, 18);
    v_locked_escrow NUMERIC(36, 18);
    v_locked_withdrawal NUMERIC(36, 18);
    v_new_available NUMERIC(36, 18);
    v_idempotency_key TEXT;
    v_ledger_rows INTEGER;
BEGIN
    SELECT * INTO v_deposit
    FROM public.onchain_deposits
    WHERE id = p_deposit_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Deposit record not found for ID %', p_deposit_id;
    END IF;

    IF v_deposit.status = 'CREDITED' THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Deposit already credited',
            'deposit_id', p_deposit_id,
            'status', 'CREDITED'
        );
    END IF;

    -- Never credit a pending/failed record or one below its configured
    -- confirmation threshold, even if a privileged caller invokes this RPC.
    IF v_deposit.status <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Deposit must be CONFIRMED before crediting';
    END IF;
    IF v_deposit.confirmations IS NULL
       OR v_deposit.required_confirmations IS NULL
       OR v_deposit.confirmations < v_deposit.required_confirmations THEN
        RAISE EXCEPTION 'Deposit has not reached its required confirmation threshold';
    END IF;
    IF v_deposit.amount IS NULL OR v_deposit.amount <= 0
       OR v_deposit.tx_hash IS NULL OR length(trim(v_deposit.tx_hash)) = 0
       OR v_deposit.asset_symbol IS NULL OR length(trim(v_deposit.asset_symbol)) = 0 THEN
        RAISE EXCEPTION 'Deposit record has invalid crediting fields';
    END IF;

    v_user_id := v_deposit.user_id;
    v_amount := v_deposit.amount;
    v_asset_code := UPPER(TRIM(v_deposit.asset_symbol));
    v_tx_hash := v_deposit.tx_hash;
    v_network := COALESCE(v_deposit.network, 'ERC20');
    v_idempotency_key := 'dep_proc_' || v_tx_hash || '_' || v_asset_code;

    -- 1. Ensure user wallet exists
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = v_user_id
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, status, provisioning_status)
        VALUES (v_user_id, 'active', 'completed')
        RETURNING id INTO v_wallet_id;
    END IF;

    -- 2. Ensure asset exists in assets table
    INSERT INTO public.assets (code, name, decimals, is_enabled)
    VALUES (v_asset_code, v_asset_code, 18, true)
    ON CONFLICT (code) DO NOTHING;

    -- 3. Lock & Fetch or Initialize wallet_assets
    SELECT available, locked_escrow, locked_withdrawal
    INTO v_available, v_locked_escrow, v_locked_withdrawal
    FROM public.wallet_assets
    WHERE wallet_id = v_wallet_id AND asset_code = v_asset_code
    FOR UPDATE;

    IF NOT FOUND THEN
        v_available := 0.0;
        v_locked_escrow := 0.0;
        v_locked_withdrawal := 0.0;
        v_new_available := v_amount;

        INSERT INTO public.wallet_assets (
            wallet_id,
            asset_code,
            available,
            locked_escrow,
            locked_withdrawal
        )
        VALUES (
            v_wallet_id,
            v_asset_code,
            v_amount,
            0.0,
            0.0
        );
    ELSE
        v_new_available := v_available + v_amount;
        UPDATE public.wallet_assets
        SET available = v_new_available,
            updated_at = NOW()
        WHERE wallet_id = v_wallet_id AND asset_code = v_asset_code;
    END IF;

    -- 4. Record Immutable Ledger Entry
    INSERT INTO public.ledger_entries (
        wallet_id,
        user_id,
        asset_code,
        delta_available,
        delta_locked,
        available_after,
        locked_after,
        entry_type,
        ref_table,
        ref_id,
        idempotency_key
    )
    VALUES (
        v_wallet_id,
        v_user_id,
        v_asset_code,
        v_amount,
        0.0,
        v_new_available,
        COALESCE(v_locked_escrow, 0) + COALESCE(v_locked_withdrawal, 0),
        'deposit_credit',
        'onchain_deposits',
        v_tx_hash,
        'ledger_' || v_idempotency_key
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- If the immutable ledger entry already exists, abort the entire transaction.
    -- This rolls back the balance mutation above instead of crediting without a
    -- newly recorded ledger entry.
    GET DIAGNOSTICS v_ledger_rows = ROW_COUNT;
    IF v_ledger_rows <> 1 THEN
        RAISE EXCEPTION 'Deposit ledger idempotency conflict for %', v_idempotency_key;
    END IF;

    -- 5. Mark onchain_deposits status as CREDITED
    UPDATE public.onchain_deposits
    SET status = 'CREDITED',
        credited_at = NOW(),
        updated_at = NOW()
    WHERE id = p_deposit_id;

    -- 6. Upsert into standard deposits table
    INSERT INTO public.deposits (
        user_id,
        wallet_id,
        asset_code,
        network_code,
        amount,
        txid,
        confirmations,
        status,
        credited_at,
        idempotency_key
    )
    VALUES (
        v_user_id,
        v_wallet_id,
        v_asset_code,
        v_network,
        v_amount,
        v_tx_hash,
        v_deposit.confirmations,
        'credited',
        NOW(),
        v_idempotency_key
    )
    ON CONFLICT (idempotency_key) DO UPDATE
    SET status = 'credited',
        credited_at = NOW(),
        updated_at = NOW();

    RETURN jsonb_build_object(
        'success', true,
        'deposit_id', p_deposit_id,
        'user_id', v_user_id,
        'wallet_id', v_wallet_id,
        'asset', v_asset_code,
        'credited_amount', v_amount,
        'new_balance', v_new_available,
        'tx_hash', v_tx_hash
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_confirmed_deposit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_confirmed_deposit(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.process_confirmed_deposit(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_confirmed_deposit(uuid) TO service_role;
