import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
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

    const adminClient = getSupabaseAdminClient();

    const body = await req.json().catch(() => ({}));
    const { action, reason, receiptUrl } = body;
    const totpCode = body.totpCode || body.totp_code || body.code;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);

    // Fetch trade record (support by UUID or trade_id)
    let tradeQuery = adminClient.from('trades').select('*');
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
      const { data: bp } = await adminClient.from('profiles').select('username').eq('id', trade.buyer_id).maybeSingle();
      if (bp?.username) buyerName = bp.username;
    }
    if (trade?.seller_id) {
      const { data: sp } = await adminClient.from('profiles').select('username').eq('id', trade.seller_id).maybeSingle();
      if (sp?.username) sellerName = sp.username;
    }

    if (action === 'MARK_PAID') {
      const now = new Date().toISOString();

      // Ensure caller is the buyer or party to the trade
      if (trade?.buyer_id && trade.buyer_id !== user.id) {
        return NextResponse.json({ error: 'Only the buyer can mark this trade as paid.' }, { status: 403 });
      }

      // 1. Primary update: record paid_at, marked_paid_at, payment_confirmed_at, and escrow_status = 'PAID'
      const updateData: any = {
        paid_at: now,
        marked_paid_at: now,
        payment_confirmed_at: now,
        escrow_status: 'PAID',
      };

      let q = adminClient.from('trades').update(updateData);
      if (isActualUuid) q = q.eq('id', actualTradeId);
      else q = q.eq('trade_id', tradeId);
      const { error: updateError } = await q;

      if (updateError) {
        console.error('Failed to mark trade as paid via timestamps/escrow_status:', updateError);
        return NextResponse.json({ error: updateError.message || 'Failed to update trade status to paid.' }, { status: 400 });
      }

      // 2. Also attempt updating status: 'paid' (or uppercase 'PAID') if the database schema allows it
      try {
        let qStatus = adminClient.from('trades').update({ status: 'paid' });
        if (isActualUuid) qStatus = qStatus.eq('id', actualTradeId);
        else qStatus = qStatus.eq('trade_id', tradeId);
        const { error: statusErr } = await qStatus;
        if (statusErr) {
          console.warn('Status enum update warning (recorded via escrow_status and paid_at):', statusErr.message);
        }
      } catch (err: any) {
        console.warn('Status enum update exception caught:', err.message);
      }

      // Also sync p2p_trades if applicable
      try {
        await adminClient
          .from('p2p_trades')
          .update({ status: 'PAID', paid_at: now })
          .eq('id', actualTradeId);
      } catch (_) {}

      // Post official Paxones system announcement
      try {
        await insertPaxonesSystemMessage(adminClient, {
          tradeId: actualTradeId,
          type: 'MARKED_PAID',
          buyerUsername: buyerName,
          sellerUsername: sellerName
        });
      } catch (sysErr) {
        console.warn('System message insert warning:', sysErr);
      }

      // Notification for seller
      if (trade?.seller_id) {
        try {
          await adminClient.from('notifications').insert({
            user_id: trade.seller_id,
            title: 'Payment Marked as Paid',
            message: `Buyer @${buyerName} has marked trade as paid. Please verify receiving account before releasing.`,
            link: `/trade/${actualTradeId}`,
            is_read: false,
            created_at: now
          }).select().maybeSingle();
        } catch (notifErr) {
          console.warn('Notification insert warning:', notifErr);
        }
      }

      return NextResponse.json({ success: true, message: 'Payment marked successfully.' });
    }

    if (action === 'EXPIRE_TRADE') {
      const now = new Date().toISOString();

      // Guard: If trade is already marked paid, released, completed, or disputed, DO NOT expire
      const isAlreadyPaid = Boolean(
        trade?.paid_at ||
        trade?.marked_paid_at ||
        trade?.payment_confirmed_at ||
        trade?.escrow_status === 'PAID' ||
        ['paid', 'buyer_marked_paid', 'payment_sent'].includes((trade?.status || '').toLowerCase())
      );
      if (isAlreadyPaid) {
        return NextResponse.json(
          { success: false, message: 'Trade was marked as paid and cannot be expired.' },
          { status: 400 }
        );
      }

      if (['completed', 'released', 'disputed', 'cancelled', 'expired'].includes((trade?.status || '').toLowerCase())) {
        return NextResponse.json(
          { success: false, message: `Trade is already ${trade.status} and cannot be expired.` },
          { status: 400 }
        );
      }

      // Canonical RPC call
      const { data: rpcData, error: rpcError } = await adminClient.rpc('expire_p2p_trade', {
        p_trade_id: actualTradeId,
      });

      if (rpcError || (rpcData && !rpcData.success)) {
        const errorMsg = rpcError?.message || rpcData?.message || 'Failed to expire trade.';
        console.error('expire_p2p_trade RPC failed:', errorMsg);
        return NextResponse.json({ error: errorMsg }, { status: 400 });
      }

      // Post official system message in trade chat if not already present
      try {
        const { data: existingMsg } = await adminClient
          .from('trade_messages')
          .select('id')
          .eq('trade_id', actualTradeId)
          .ilike('message', '%TRADE EXPIRED%')
          .limit(1)
          .maybeSingle();

        if (!existingMsg) {
          await insertPaxonesSystemMessage(adminClient, {
            tradeId: actualTradeId,
            type: 'TRADE_EXPIRED',
            buyerUsername: buyerName,
            sellerUsername: sellerName,
            coinAmount: trade?.crypto_amount || trade?.amount,
            coinSymbol: trade?.crypto || trade?.asset_symbol || 'USDT'
          });
        }
      } catch (sysMsgErr) {
        console.warn('Error inserting expired system message:', sysMsgErr);
      }

      // Notify both parties
      const userIds = [trade?.buyer_id, trade?.seller_id].filter(Boolean);
      for (const uid of userIds) {
        try {
          await adminClient.from('notifications').insert({
            user_id: uid,
            title: 'Trade Expired',
            message: `Trade has expired because payment was not confirmed within the countdown window.`,
            link: `/trade/${actualTradeId}`,
            is_read: false,
            created_at: now
          }).select().maybeSingle();
        } catch {}
      }

      return NextResponse.json({ success: true, message: rpcData?.message || 'Trade marked as expired.' });
    }

    if (action === 'RELEASE_ESCROW') {
      // Ensure caller is the seller
      if (trade?.seller_id && trade.seller_id !== user.id) {
        return NextResponse.json({ error: 'Only the seller can release escrow.' }, { status: 403 });
      }

      // Verify seller can only release when buyer marked paid OR when trade is in dispute
      const rawStatus = String(trade?.status || '').toLowerCase();
      const rawEscrowStatus = String(trade?.escrow_status || '').toUpperCase();
      const isPaid = Boolean(trade?.paid_at || trade?.marked_paid_at || rawEscrowStatus === 'PAID' || ['paid', 'buyer_marked_paid', 'payment_sent'].includes(rawStatus));
      const isDisputed = Boolean(rawStatus === 'disputed' || rawEscrowStatus === 'DISPUTED');

      if (!isPaid && !isDisputed) {
        return NextResponse.json({
          error: 'Escrow can only be released after the buyer marks the trade as paid, or if the trade is in dispute.'
        }, { status: 400 });
      }

      // 2FA check for sensitive trade release operation
      const { data: sellerProfile } = await adminClient
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

      // Canonical RPC call
      const { data: rpcData, error: rpcError } = await adminClient.rpc('release_trade_escrow', {
        p_trade_id: actualTradeId,
        p_seller_id: user.id,
      });

      if (rpcError || (rpcData && !rpcData.success)) {
        const errorMsg = rpcError?.message || rpcData?.message || 'Failed to release escrow.';
        console.error('release_trade_escrow RPC failed:', errorMsg);
        return NextResponse.json({ error: errorMsg }, { status: 400 });
      }

      const coinAmount = Number(trade?.amount ?? trade?.crypto_amount ?? 0);
      const coinSymbol = (trade?.crypto ?? trade?.asset_symbol ?? 'USDT').toUpperCase();
      const now = new Date().toISOString();

      try {
        await insertPaxonesSystemMessage(adminClient, {
          tradeId: actualTradeId,
          type: 'TRADE_COMPLETED',
          sellerUsername: sellerName,
          buyerUsername: buyerName,
          coinAmount,
          coinSymbol
        });
      } catch (msgErr) {
        console.warn('System message insert warning:', msgErr);
      }

      if (trade?.buyer_id) {
        try {
          await adminClient.from('notifications').insert({
            user_id: trade.buyer_id,
            title: 'Escrow Released',
            message: `@${sellerName} released ${coinAmount} ${coinSymbol} to your wallet.`,
            link: `/trade/${actualTradeId}`,
            is_read: false,
            created_at: now
          }).select().maybeSingle();
        } catch (notifErr) {
          console.warn('Notification insert warning:', notifErr);
        }
      }

      return NextResponse.json({ success: true, message: rpcData?.message || 'Escrow released successfully.' });
    }

    if (action === 'CANCEL_TRADE') {
      const now = new Date().toISOString();

      // Canonical RPC call
      const { data: rpcData, error: rpcError } = await adminClient.rpc('cancel_p2p_trade', {
        p_trade_id: actualTradeId,
        p_user_id: user.id,
        p_reason: reason || 'Cancelled by buyer',
      });

      if (rpcError || (rpcData && !rpcData.success)) {
        const errorMsg = rpcError?.message || rpcData?.message || 'Failed to cancel trade.';
        console.error('cancel_p2p_trade RPC failed:', errorMsg);
        return NextResponse.json({ error: errorMsg }, { status: 400 });
      }

      try {
        await insertPaxonesSystemMessage(adminClient, {
          tradeId: actualTradeId,
          type: 'TRADE_CANCELLED'
        });
      } catch (msgErr) {
        console.warn('System message insert warning:', msgErr);
      }

      const counterpartyId = user.id === trade?.buyer_id ? trade?.seller_id : trade?.buyer_id;
      if (counterpartyId) {
        try {
          await adminClient.from('notifications').insert({
            user_id: counterpartyId,
            title: 'Trade Cancelled',
            message: `Trade has been cancelled. Any locked escrow has been refunded to the seller.`,
            link: `/trade/${actualTradeId}`,
            is_read: false,
            created_at: now
          }).select().maybeSingle();
        } catch (notifErr) {
          console.warn('Notification insert warning:', notifErr);
        }
      }

      return NextResponse.json({ success: true, message: rpcData?.message || 'Trade cancelled successfully.' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('Error in trade action handler:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
