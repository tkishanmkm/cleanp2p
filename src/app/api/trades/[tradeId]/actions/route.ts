import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { insertPaxonesSystemMessage } from '@/lib/trade-system-messages';
import { verify2FAOTP } from '@/lib/2fa';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    const resolvedParams = typeof (params as any)?.then === 'function' ? await params : params;
    const tradeId = resolvedParams.tradeId;

    if (!tradeId) {
      return NextResponse.json({ error: 'Trade ID is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user || (await supabase.auth.getUser()).data.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, reason, receiptUrl } = body;
    const totpCode = body.totpCode || body.totp_code || body.code;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);

    // Fetch trade record (support by UUID or trade_id)
    let tradeQuery = supabase.from('trades').select('*');
    if (isUuid) {
      tradeQuery = tradeQuery.or(`id.eq.${tradeId},trade_id.eq.${tradeId}`);
    } else {
      tradeQuery = tradeQuery.eq('trade_id', tradeId);
    }
    const { data: trade } = await tradeQuery.maybeSingle();

    const actualTradeId = trade?.id || tradeId;
    const isActualUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actualTradeId);

    // Fetch buyer and seller profiles for mentions
    let buyerName = 'Buyer';
    let sellerName = 'Seller';
    if (trade?.buyer_id) {
      const { data: bp } = await supabase.from('profiles').select('username').eq('id', trade.buyer_id).maybeSingle();
      if (bp?.username) buyerName = bp.username;
    }
    if (trade?.seller_id) {
      const { data: sp } = await supabase.from('profiles').select('username').eq('id', trade.seller_id).maybeSingle();
      if (sp?.username) sellerName = sp.username;
    }

    if (action === 'MARK_PAID') {
      const now = new Date().toISOString();
      let updateQuery = supabase
        .from('trades')
        .update({
          status: 'PAID',
          payment_confirmed_at: now,
          paid_at: now,
        });

      if (isActualUuid) {
        updateQuery = updateQuery.eq('id', actualTradeId);
      } else {
        updateQuery = updateQuery.eq('trade_id', tradeId);
      }
      updateQuery = updateQuery.eq('buyer_id', user.id);

      const { error } = await updateQuery;

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      // Post official Paxones system announcement
      await insertPaxonesSystemMessage(supabase, {
        tradeId: actualTradeId,
        type: 'MARKED_PAID',
        buyerUsername: buyerName,
        sellerUsername: sellerName
      });

      return NextResponse.json({ success: true, message: 'Payment marked successfully.' });
    }

    if (action === 'RELEASE_ESCROW') {
      // 2FA check for sensitive trade release operation
      const { data: sellerProfile } = await supabase
        .from('profiles')
        .select('is_2fa_enabled, is_mfa_enabled, two_factor_secret, security_answer_hash')
        .eq('id', user.id)
        .maybeSingle();

      const is2faActive = Boolean(sellerProfile?.is_2fa_enabled || sellerProfile?.is_mfa_enabled);
      const secret = sellerProfile?.two_factor_secret || sellerProfile?.security_answer_hash;

      if (is2faActive) {
        if (!totpCode) {
          return NextResponse.json(
            { error: 'TWO_FACTOR_REQUIRED: 2FA TOTP code is required to release escrow.' },
            { status: 403 }
          );
        }
        const isValid = verify2FAOTP(secret, String(totpCode).trim(), is2faActive);
        if (!isValid) {
          return NextResponse.json({ error: 'Invalid 2FA authentication code.' }, { status: 401 });
        }
      }

      let rpcSucceeded = false;
      let rpcResult: any = null;

      try {
        const { data, error } = await supabase.rpc('release_trade_escrow', {
          p_trade_id: actualTradeId,
          p_seller_id: user.id,
        });

        if (!error && data) {
          rpcSucceeded = true;
          rpcResult = data;
        } else if (error && error.code !== 'PGRST202') {
          // If real error occurred (not missing function)
          if (!data?.success && error.message) {
            return NextResponse.json({ error: error.message }, { status: 400 });
          }
        }
      } catch (e) {
        console.warn('release_trade_escrow RPC call failed, falling back:', e);
      }

      if (rpcSucceeded) {
        if (!rpcResult.success) {
          return NextResponse.json({ error: rpcResult.message || 'Failed to release escrow' }, { status: 400 });
        }
        return NextResponse.json({ success: true, message: rpcResult.message || 'Escrow released successfully.' });
      }

      // Fallback: direct update if RPC is missing
      const now = new Date().toISOString();
      let updateQuery = supabase
        .from('trades')
        .update({
          status: 'COMPLETED',
          escrow_status: 'released',
          released_at: now,
        });

      if (isActualUuid) {
        updateQuery = updateQuery.eq('id', actualTradeId);
      } else {
        updateQuery = updateQuery.eq('trade_id', tradeId);
      }
      updateQuery = updateQuery.eq('seller_id', user.id);

      const { error: updateError } = await updateQuery;

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      const coinAmount = Number(trade?.amount ?? trade?.crypto_amount ?? 0);
      const coinSymbol = trade?.crypto ?? trade?.asset_symbol ?? 'BTC';

      await insertPaxonesSystemMessage(supabase, {
        tradeId: actualTradeId,
        type: 'TRADE_COMPLETED',
        sellerUsername: sellerName,
        buyerUsername: buyerName,
        coinAmount,
        coinSymbol
      });

      return NextResponse.json({ success: true, message: 'Escrow released successfully.' });
    }

    if (action === 'CANCEL_TRADE') {
      let rpcSucceeded = false;
      let rpcResult: any = null;

      try {
        const { data, error } = await supabase.rpc('cancel_p2p_trade', {
          p_trade_id: actualTradeId,
          p_user_id: user.id,
          p_reason: reason || 'Cancelled by user',
        });

        if (!error && data) {
          rpcSucceeded = true;
          rpcResult = data;
        } else if (error && error.code !== 'PGRST202') {
          if (!data?.success && error.message) {
            return NextResponse.json({ error: error.message }, { status: 400 });
          }
        }
      } catch (e) {
        console.warn('cancel_p2p_trade RPC call failed, falling back:', e);
      }

      if (rpcSucceeded) {
        if (!rpcResult.success) {
          return NextResponse.json({ error: rpcResult.message || 'Failed to cancel trade' }, { status: 400 });
        }
        return NextResponse.json({ success: true, message: rpcResult.message || 'Trade cancelled successfully.' });
      }

      // Fallback: direct update if RPC is missing
      let updateQuery = supabase
        .from('trades')
        .update({
          status: 'CANCELLED',
          escrow_status: 'refunded',
          cancellation_reason: reason || 'Cancelled by user',
        });

      if (isActualUuid) {
        updateQuery = updateQuery.eq('id', actualTradeId);
      } else {
        updateQuery = updateQuery.eq('trade_id', tradeId);
      }
      updateQuery = updateQuery.or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);

      const { error: updateError } = await updateQuery;

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      await insertPaxonesSystemMessage(supabase, {
        tradeId: actualTradeId,
        type: 'TRADE_CANCELLED'
      });

      return NextResponse.json({ success: true, message: 'Trade cancelled successfully.' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('Error in trade action handler:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
