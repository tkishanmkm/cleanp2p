CREATE OR REPLACE FUNCTION public.expire_unpaid_p2p_trades(p_expiry_minutes integer DEFAULT 15)
RETURNS TABLE(expired_trade_id uuid, seller_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_trade record;
  v_seller_id uuid;
  v_total_locked numeric;
  v_balance_after numeric;
  v_escrow_after numeric;
BEGIN
  IF p_expiry_minutes IS NULL OR p_expiry_minutes < 1 OR p_expiry_minutes > 1440 THEN
    RAISE EXCEPTION 'p_expiry_minutes must be between 1 and 1440';
  END IF;

  FOR v_trade IN
    SELECT t.*
    FROM public.trades AS t
    WHERE lower(coalesce(t.status::text, '')) IN ('pending', 'created', 'active', 'escrow_locked')
      AND lower(coalesce(t.escrow_status, '')) IN ('pending', 'escrow_locked', 'locked')
      AND t.paid_at IS NULL
      AND t.marked_paid_at IS NULL
      AND t.payment_confirmed_at IS NULL
      AND NOT coalesce(t.is_disputed, false)
      AND lower(coalesce(t.escrow_status, '')) <> 'disputed'
      AND t.released_at IS NULL
      AND (
        (t.expires_at IS NOT NULL AND t.expires_at <= now())
        OR (t.expires_at IS NULL AND t.created_at < now() - make_interval(mins => p_expiry_minutes))
      )
    ORDER BY coalesce(t.expires_at, t.created_at + make_interval(mins => p_expiry_minutes)), t.id
    FOR UPDATE OF t SKIP LOCKED
  LOOP
    BEGIN
      v_seller_id := v_trade.seller_id::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      -- Do not mutate a trade whose seller identity cannot be resolved safely.
      CONTINUE;
    END;

    v_total_locked := coalesce(nullif(v_trade.crypto_amount, 0), v_trade.amount, 0)
                    + coalesce(nullif(v_trade.escrow_fee, 0), v_trade.fee_crypto, 0);

    IF v_total_locked <= 0 THEN
      CONTINUE;
    END IF;

    -- Lock and validate the canonical asset row. Never create a missing row
    -- or clamp escrow to zero: either could hide a reconciliation defect.
    SELECT wa.balance, wa.in_escrow
      INTO v_balance_after, v_escrow_after
    FROM public.wallet_assets AS wa
    WHERE wa.user_id = v_seller_id
      AND upper(wa.asset_symbol) = upper(coalesce(v_trade.crypto, v_trade.asset_code, v_trade.asset, 'USDT'))
    FOR UPDATE;

    IF NOT FOUND OR coalesce(v_escrow_after, 0) < v_total_locked THEN
      -- Fail closed: leave the trade untouched for manual reconciliation.
      CONTINUE;
    END IF;

    UPDATE public.wallet_assets AS wa
    SET balance = coalesce(wa.balance, 0) + v_total_locked,
        in_escrow = coalesce(wa.in_escrow, 0) - v_total_locked,
        updated_at = now()
    WHERE wa.user_id = v_seller_id
      AND upper(wa.asset_symbol) = upper(coalesce(v_trade.crypto, v_trade.asset_code, v_trade.asset, 'USDT'))
      AND coalesce(wa.in_escrow, 0) >= v_total_locked
    RETURNING wa.balance, wa.in_escrow INTO v_balance_after, v_escrow_after;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    INSERT INTO public.ledger_entries (
      user_id, crypto, asset, amount, type, reference_id, balance_after, metadata, status
    ) VALUES (
      v_seller_id,
      upper(coalesce(v_trade.crypto, v_trade.asset_code, v_trade.asset, 'USDT')),
      upper(coalesce(v_trade.crypto, v_trade.asset_code, v_trade.asset, 'USDT')),
      v_total_locked,
      'transfer',
      'trade_expiry_refund:' || v_trade.id::text,
      v_balance_after,
      jsonb_build_object(
        'action', 'trade_expiry_refund',
        'trade_id', v_trade.id,
        'crypto_amount', coalesce(nullif(v_trade.crypto_amount, 0), v_trade.amount, 0),
        'escrow_fee_refunded', coalesce(nullif(v_trade.escrow_fee, 0), v_trade.fee_crypto, 0),
        'total_refunded', v_total_locked
      ),
      'completed'
    );

    UPDATE public.trades
    SET status = 'CANCELLED',
        escrow_status = 'CANCELLED',
        cancelled_at = now(),
        expired_at = now(),
        resolved_at = now(),
        updated_at = now(),
        cancellation_reason = 'Payment window expired; escrow returned to seller'
    WHERE id = v_trade.id
      AND lower(coalesce(status::text, '')) IN ('pending', 'created', 'active', 'escrow_locked')
      AND paid_at IS NULL
      AND marked_paid_at IS NULL
      AND payment_confirmed_at IS NULL
      AND NOT coalesce(is_disputed, false)
      AND released_at IS NULL;

    IF NOT FOUND THEN
      -- Any prior balance/ledger mutations are rolled back if an exception
      -- occurs; this guard also protects against unexpected state changes.
      RAISE EXCEPTION 'Trade state changed while expiring trade %', v_trade.id;
    END IF;

    INSERT INTO public.trade_messages (trade_id, sender_id, message, is_moderator)
    VALUES (
      v_trade.id::text,
      v_seller_id::text,
      'Trade expired because the payment window elapsed. Escrow was returned to the seller.',
      false
    );

    expired_trade_id := v_trade.id;
    seller_id := v_seller_id;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.expire_unpaid_p2p_trades(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_p2p_trades(integer) TO service_role;