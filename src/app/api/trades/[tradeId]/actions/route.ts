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

    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    let user: any = null;
    if (bearerToken) {
      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user;
    }
    if (!user) {
      const { data: { session } } = await supabase.auth.getSession();
      user = session?.user || (await supabase.auth.getUser()).data.user;
    }

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

      if (!trade) {
        return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });
      }

      // Ensure caller is strictly the buyer derived from the database record
      if (trade.buyer_id !== user.id) {
        return NextResponse.json({ error: 'Only the buyer can mark this trade as paid.' }, { status: 403 });
      }

      // Check current trade state before marking paid
      const rawStatus = String(trade.status || '').toLowerCase();
      const rawEscrowStatus = String(trade.escrow_status || '').toLowerCase();

      if (['completed', 'released'].includes(rawStatus) || ['completed', 'released'].includes(rawEscrowStatus)) {
        return NextResponse.json({ error: 'Cannot mark paid: trade is already completed or released.' }, { status: 400 });
      }

      if (['cancelled', 'canceled', 'expired'].includes(rawStatus) || ['cancelled', 'expired'].includes(rawEscrowStatus)) {
        return NextResponse.json({ error: `Cannot mark paid: trade is already ${rawStatus || rawEscrowStatus}.` }, { status: 400 });
      }

      if (['disputed', 'dispute'].includes(rawStatus) || rawEscrowStatus === 'disputed') {
        return NextResponse.json({ error: 'Cannot mark paid: trade is currently in dispute.' }, { status: 400 });
      }

      // 1. Read the trade's already stored payment_method
      const tradeStoredMethod = typeof trade?.payment_method === 'string' ? trade.payment_method.trim() : '';

      // 2. Fetch ad payment methods defensively across p2p_ads and ads tables
      let allowedMethods: string[] = [];
      const adId = trade?.ad_id || trade?.advertisement_id || trade?.ad_public_id || trade?.adId;
      const publicAdId = trade?.public_ad_id || trade?.ad_public_id;

      if (adId || publicAdId) {
        try {
          const rawAdRef = String(adId || publicAdId).trim();
          const isAdUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawAdRef);
          let adRecord: any = null;

          // A. Lookup in p2p_ads safely without invalid UUID syntax errors
          let p2pAdQuery = adminClient.from('p2p_ads').select('payment_methods');
          if (isAdUuid) {
            p2pAdQuery = p2pAdQuery.or(`id.eq.${rawAdRef},public_ad_id.eq.${rawAdRef}`);
          } else {
            p2pAdQuery = p2pAdQuery.eq('public_ad_id', rawAdRef);
          }
          const { data: p2pData } = await p2pAdQuery.maybeSingle();
          if (p2pData) adRecord = p2pData;

          // B. If not found in p2p_ads, check legacy public.ads
          if (!adRecord) {
            let legacyAdQuery = adminClient.from('ads').select('payment_methods');
            legacyAdQuery = legacyAdQuery.or(`id.eq.${rawAdRef},public_ad_id.eq.${rawAdRef}`);
            const { data: legacyData } = await legacyAdQuery.maybeSingle();
            if (legacyData) adRecord = legacyData;
          }

          if (adRecord?.payment_methods) {
            if (Array.isArray(adRecord.payment_methods)) {
              allowedMethods = adRecord.payment_methods;
            } else if (typeof adRecord.payment_methods === 'string') {
              try {
                const parsed = JSON.parse(adRecord.payment_methods);
                allowedMethods = Array.isArray(parsed) ? parsed : [adRecord.payment_methods];
              } catch {
                allowedMethods = [adRecord.payment_methods];
              }
            }
          }
        } catch (adLookupErr) {
          console.warn('[actions/MARK_PAID] Notice resolving advertisement payment methods:', adLookupErr);
        }
      }

      allowedMethods = allowedMethods.filter((m: any) => typeof m === 'string' && m.trim().length > 0);

      // If ad lookup yielded no payment methods but the trade has an agreed payment_method, use that
      if (allowedMethods.length === 0 && tradeStoredMethod) {
        allowedMethods = [tradeStoredMethod];
      }

      const requestedPaymentMethod = typeof (body.paymentMethod || body.payment_method) === 'string'
        ? (body.paymentMethod || body.payment_method).trim()
        : '';

      let confirmedPaymentMethod = '';
      if (allowedMethods.length > 1) {
        if (!requestedPaymentMethod) {
          if (tradeStoredMethod && allowedMethods.some((m) => m.trim().toLowerCase() === tradeStoredMethod.toLowerCase())) {
            confirmedPaymentMethod = tradeStoredMethod;
          } else {
            return NextResponse.json({ error: 'Please select the payment method used to make payment.' }, { status: 400 });
          }
        } else {
          const matched = allowedMethods.find((m) => m.trim().toLowerCase() === requestedPaymentMethod.toLowerCase());
          if (!matched) {
            return NextResponse.json({ error: `Selected payment method "${requestedPaymentMethod}" is not supported by this trade.` }, { status: 400 });
          }
          confirmedPaymentMethod = matched;
        }
      } else if (allowedMethods.length === 1) {
        if (requestedPaymentMethod) {
          const matched = allowedMethods.find((m) => m.trim().toLowerCase() === requestedPaymentMethod.toLowerCase());
          if (!matched) {
            return NextResponse.json({ error: `Selected payment method "${requestedPaymentMethod}" is not supported by this trade.` }, { status: 400 });
          }
          confirmedPaymentMethod = matched;
        } else {
          confirmedPaymentMethod = allowedMethods[0];
        }
      } else {
        confirmedPaymentMethod = requestedPaymentMethod || tradeStoredMethod || 'Bank Transfer';
      }

      // Execute Atomic Database RPC mark_p2p_trade_paid
      const { data: rpcData, error: rpcError } = await adminClient.rpc('mark_p2p_trade_paid', {
        p_trade_id: actualTradeId,
        p_caller_id: user.id,
        p_payment_method: confirmedPaymentMethod,
      });

      if (rpcError || (rpcData && !rpcData.success)) {
        const errorMsg = rpcError?.message || rpcData?.message || 'Failed to mark trade as paid.';
        console.error('mark_p2p_trade_paid RPC failed:', errorMsg);
        return NextResponse.json({ error: errorMsg }, { status: 400 });
      }

      // Also sync p2p_trades if applicable
      try {
        await adminClient
          .from('p2p_trades')
          .update({ status: 'PAID', paid_at: now, payment_method: confirmedPaymentMethod })
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
            type: 'trade_action',
            is_read: false,
            metadata: { link: `/trade/${actualTradeId}` },
            created_at: now
          }).select().maybeSingle();
        } catch (notifErr) {
          console.warn('Notification insert warning:', notifErr);
        }
      }

      return NextResponse.json({ success: true, message: 'Payment marked successfully.' });
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
        p_caller_id: user.id,
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
            type: 'trade_action',
            is_read: false,
            metadata: { link: `/trade/${actualTradeId}` },
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
        p_caller_id: user.id,
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
            type: 'trade_action',
            is_read: false,
            metadata: { link: `/trade/${actualTradeId}` },
            created_at: now
          }).select().maybeSingle();
        } catch (notifErr) {
          console.warn('Notification insert warning:', notifErr);
        }
      }

      return NextResponse.json({ success: true, message: rpcData?.message || 'Trade cancelled successfully.' });
    }

    if (action === 'EXPIRE_TRADE') {
      const now = new Date().toISOString();

      if (!trade) {
        return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });
      }

      // Check caller authorization: buyer, seller, or admin
      const isParticipant = user.id === trade.buyer_id || user.id === trade.seller_id;
      const isAdmin = userRole === 'admin' || user.app_metadata?.role === 'admin' || user.user_metadata?.role === 'admin';

      if (!isParticipant && !isAdmin) {
        return NextResponse.json({ error: 'Unauthorized: Only trade participants or administrators can trigger trade expiration.' }, { status: 403 });
      }

      // Check terminal status
      const rawStatus = String(trade.status || '').toLowerCase();
      const rawEscrowStatus = String(trade.escrow_status || '').toUpperCase();

      if (
        ['completed', 'released', 'cancelled', 'expired'].includes(rawStatus) ||
        ['COMPLETED', 'RELEASED', 'CANCELLED', 'EXPIRED'].includes(rawEscrowStatus) ||
        trade.cancelled_at ||
        trade.released_at ||
        trade.completed_at ||
        trade.expired_at
      ) {
        return NextResponse.json({ error: `Cannot expire trade: Trade is already in terminal '${rawStatus || rawEscrowStatus}' state.` }, { status: 400 });
      }

      // Check paid or disputed guard
      const isPaid = Boolean(
        trade.paid_at ||
        trade.marked_paid_at ||
        rawEscrowStatus === 'PAID' ||
        ['paid', 'buyer_marked_paid', 'payment_sent'].includes(rawStatus)
      );
      const isDisputed = Boolean(rawStatus === 'disputed' || rawEscrowStatus === 'DISPUTED' || trade.is_disputed);

      if (isPaid) {
        return NextResponse.json({ error: 'Cannot expire trade: Payment has already been marked by the buyer.' }, { status: 400 });
      }

      if (isDisputed) {
        return NextResponse.json({ error: 'Cannot expire trade: A dispute is active on this trade.' }, { status: 400 });
      }

      // Check expiration timestamp
      if (!trade.expires_at || new Date(trade.expires_at).getTime() > Date.now()) {
        return NextResponse.json({ error: 'Trade payment window has not expired yet.' }, { status: 400 });
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

      try {
        await insertPaxonesSystemMessage(adminClient, {
          tradeId: actualTradeId,
          type: 'TRADE_EXPIRED',
        });
      } catch (msgErr) {
        console.warn('System message insert warning:', msgErr);
      }

      const participantIds = [trade.buyer_id, trade.seller_id].filter(Boolean);
      for (const pid of participantIds) {
        try {
          await adminClient.from('notifications').insert({
            user_id: pid,
            title: 'Trade Expired',
            message: 'Trade payment window expired. Any locked escrow deposit has been refunded to the seller.',
            type: 'trade_action',
            is_read: false,
            metadata: { link: `/trade/${actualTradeId}` },
            created_at: now,
          }).select().maybeSingle();
        } catch (_) {}
      }

      return NextResponse.json({ success: true, message: rpcData?.message || 'Trade expired successfully.' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('Error in trade action handler:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
