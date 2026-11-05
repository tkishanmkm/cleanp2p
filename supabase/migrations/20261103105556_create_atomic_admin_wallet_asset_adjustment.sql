BEGIN;

CREATE OR REPLACE FUNCTION public.admin_adjust_wallet_asset_balance(
  p_admin_id uuid,
  p_target_user_id uuid,
  p_asset_symbol text,
  p_action text,
  p_amount numeric,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_asset text := upper(pg_catalog.btrim(coalesce(p_asset_symbol, '')));
  v_action text := lower(pg_catalog.btrim(coalesce(p_action, '')));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_decimals integer;
  v_admin_email text;
  v_is_admin boolean := false;
  v_existing public.ledger_entries%ROWTYPE;
  v_wallet public.wallet_assets%ROWTYPE;
  v_current_balance numeric(36,18);
  v_new_balance numeric(36,18);
  v_signed_amount numeric(36,18);
  v_event_type text;
  v_reference text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required for wallet balance adjustment'
      USING ERRCODE = '42501';
  END IF;

  IF p_admin_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Administrator and target user identifiers are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE u.id = p_admin_id
      AND coalesce(p.is_banned, false) = false
      AND coalesce(p.is_suspended, false) = false
      AND coalesce(p.is_on_hold, false) = false
      AND lower(coalesce(p.status::text, '')) NOT IN ('banned', 'suspended')
      AND (
        lower(coalesce(p.role::text, '')) = 'admin'
        OR coalesce(p.is_admin, false) = true
        OR coalesce(p.is_admin_account, false) = true
        OR lower(coalesce(u.raw_app_meta_data->>'role', '')) = 'admin'
        OR lower(coalesce(u.raw_app_meta_data->>'is_admin', 'false')) = 'true'
        OR EXISTS (
          SELECT 1 FROM public.app_admins a WHERE a.user_id = p_admin_id
        )
      )
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'A provisioned, active administrator is required'
      USING ERRCODE = '42501';
  END IF;

  IF v_asset = '' OR length(v_asset) > 16
     OR v_action NOT IN ('add', 'subtract')
     OR p_amount IS NULL OR p_amount <= 0 OR p_amount > 500000
     OR length(v_reason) < 3 OR length(v_reason) > 500
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^admin_balance_adjust:[0-9a-fA-F-]{36}$' THEN
    RAISE EXCEPTION 'Invalid wallet adjustment request'
      USING ERRCODE = '22023';
  END IF;

  SELECT a.decimals
    INTO v_decimals
  FROM public.assets a
  WHERE upper(a.code) = v_asset;

  IF NOT FOUND OR v_decimals IS NULL OR v_decimals < 0 OR v_decimals > 18 THEN
    RAISE EXCEPTION 'Unsupported wallet asset'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount <> pg_catalog.trunc(p_amount, v_decimals) THEN
    RAISE EXCEPTION 'Adjustment amount exceeds the precision supported by this asset'
      USING ERRCODE = '22023';
  END IF;

  SELECT nullif(pg_catalog.btrim(u.email), '')
    INTO v_admin_email
  FROM auth.users u
  WHERE u.id = p_admin_id;

  -- Serialize retries that carry the same client-generated request key.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_idempotency_key, 0)
  );

  SELECT *
    INTO v_existing
  FROM public.ledger_entries le
  WHERE le.idempotency_key = p_idempotency_key
  FOR UPDATE;

  v_event_type := CASE
    WHEN v_action = 'add' THEN 'admin_add'
    ELSE 'admin_subtract'
  END;
  v_signed_amount := CASE
    WHEN v_action = 'add' THEN p_amount
    ELSE -p_amount
  END;
  v_reference := 'ADMIN-ADJ:' || p_idempotency_key;

  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_target_user_id
       OR upper(coalesce(v_existing.crypto, '')) IS DISTINCT FROM v_asset
       OR v_existing.amount IS DISTINCT FROM v_signed_amount
       OR v_existing.type IS DISTINCT FROM v_event_type
       OR v_existing.metadata->>'admin_id' IS DISTINCT FROM p_admin_id::text
       OR v_existing.metadata->>'reason' IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'Idempotency key is already bound to a different adjustment'
        USING ERRCODE = '23505';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'idempotent', true,
      'new_balance', v_existing.balance_after,
      'currency', v_asset,
      'action', v_action
    );
  END IF;

  -- Create an empty asset row only for credits; a debit cannot create funds.
  IF v_action = 'add' THEN
    INSERT INTO public.wallet_assets (
      user_id, asset_symbol, balance,
      locked_balance, reserved_balance, in_escrow, in_withdrawal,
      created_at, updated_at
    )
    VALUES (
      p_target_user_id, v_asset, 0,
      0, 0, 0, 0,
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    )
    ON CONFLICT (user_id, asset_symbol) DO NOTHING;
  END IF;

  SELECT *
    INTO v_wallet
  FROM public.wallet_assets wa
  WHERE wa.user_id = p_target_user_id
    AND upper(wa.asset_symbol) = v_asset
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user has no wallet for the selected asset'
      USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(v_wallet.balance, 0) < 0
     OR coalesce(v_wallet.locked_balance, 0) < 0
     OR coalesce(v_wallet.reserved_balance, 0) < 0
     OR coalesce(v_wallet.in_escrow, 0) < 0
     OR coalesce(v_wallet.in_withdrawal, 0) < 0 THEN
    RAISE EXCEPTION 'Wallet accounting buckets are inconsistent; adjustment is held for reconciliation'
      USING ERRCODE = '55000';
  END IF;

  v_current_balance := coalesce(v_wallet.balance, 0);

  IF v_action = 'subtract' AND v_current_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient available balance for this debit'
      USING ERRCODE = '22023';
  END IF;

  v_new_balance := CASE
    WHEN v_action = 'add' THEN v_current_balance + p_amount
    ELSE v_current_balance - p_amount
  END;

  UPDATE public.wallet_assets
  SET balance = v_new_balance,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_wallet.id;

  -- This ledger row is the idempotency record and part of the same transaction.
  INSERT INTO public.ledger_entries (
    user_id, crypto, amount, type, reference_id, balance_after,
    metadata, created_at, asset, chain, status, idempotency_key
  )
  VALUES (
    p_target_user_id,
    v_asset,
    v_signed_amount,
    v_event_type,
    v_reference,
    v_new_balance,
    pg_catalog.jsonb_build_object(
      'event', 'admin_wallet_balance_adjustment',
      'actor_type', 'admin',
      'admin_id', p_admin_id,
      'reason', v_reason,
      'action', v_action,
      'asset', v_asset,
      'amount', p_amount,
      'old_balance', v_current_balance,
      'new_balance', v_new_balance,
      'idempotency_key', p_idempotency_key
    ),
    pg_catalog.clock_timestamp(),
    v_asset,
    'ADMIN',
    'completed',
    p_idempotency_key
  );

  INSERT INTO public.admin_audit_logs (
    admin_id, admin_email, action, target_id, target_user_id, details, created_at
  )
  VALUES (
    p_admin_id,
    v_admin_email,
    'ADJUST_BALANCE',
    p_target_user_id::text,
    p_target_user_id,
    pg_catalog.jsonb_build_object(
      'currency', v_asset,
      'action', v_action,
      'amount', p_amount,
      'old_balance', v_current_balance,
      'new_balance', v_new_balance,
      'reason', v_reason,
      'idempotency_key', p_idempotency_key
    ),
    pg_catalog.clock_timestamp()
  );

  INSERT INTO public.notifications (
    user_id, title, message, type, is_read, read, metadata, created_at
  )
  VALUES (
    p_target_user_id,
    'Wallet Balance Adjustment',
    pg_catalog.format(
      'Your %s balance was adjusted by administrator: %s%s %s. Reason: %s',
      v_asset,
      CASE WHEN v_action = 'add' THEN '+' ELSE '-' END,
      pg_catalog.to_char(p_amount, 'FM999999999999990D99999999'),
      v_asset,
      v_reason
    ),
    'admin_adjustment',
    false,
    false,
    pg_catalog.jsonb_build_object(
      'link', '/wallets',
      'asset', v_asset,
      'action', v_action,
      'amount', p_amount
    ),
    pg_catalog.clock_timestamp()
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'idempotent', false,
    'old_balance', v_current_balance,
    'new_balance', v_new_balance,
    'currency', v_asset,
    'action', v_action
  );
END;
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.admin_adjust_wallet_asset_balance(uuid,uuid,text,text,numeric,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_wallet_asset_balance(uuid,uuid,text,text,numeric,text,text)
  TO service_role;

COMMIT;