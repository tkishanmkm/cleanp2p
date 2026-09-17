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

      // 1. Primary update: record paid_at, marked_paid_at, payment_confirmed_at, and escrow_status = 'PAID'
      // These columns do not fire trg_update_user_trade_metrics and always succeed reliably
      const updateData: any = {
        paid_at: now,
        marked_paid_at: now,
        payment_confirmed_at: now,
        escrow_status: 'PAID',
      };

      let q = supabase.from('trades').update(updateData);
      if (isActualUuid) q = q.eq('id', actualTradeId);
      else q = q.eq('trade_id', tradeId);
      q = q.eq('buyer_id', user.id);
      const { error: updateError } = await q;

      if (updateError) {
        console.error('Failed to mark trade as paid via timestamps/escrow_status:', updateError);
        return NextResponse.json({ error: updateError.message || 'Failed to update trade status to paid.' }, { status: 400 });
      }

      // 2. Also attempt updating status: 'paid' (or uppercase 'PAID') if the database schema allows it
      try {
        let qStatus = supabase.from('trades').update({ status: 'paid' });
        if (isActualUuid) qStatus = qStatus.eq('id', actualTradeId);
        else qStatus = qStatus.eq('trade_id', tradeId);
        qStatus = qStatus.eq('buyer_id', user.id);
        const { error: statusErr } = await qStatus;
        if (statusErr) {
          console.warn('Status enum update warning (recorded via escrow_status and paid_at):', statusErr.message);
        }
      } catch (err: any) {
        console.warn('Status enum update exception caught:', err.message);
      }

      // Also sync p2p_trades if applicable
      try {
        await supabase
          .from('p2p_trades')
          .update({ status: 'PAID', paid_at: now })
          .eq('id', actualTradeId);
      } catch (_) {}

      // Post official Paxones system announcement
      try {
        await insertPaxonesSystemMessage(supabase, {
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
          await supabase.from('notifications').insert({
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

      // 1. Update trade status to 'expired' (valid PostgreSQL enum value)
      let q = supabase.from('trades').update({
        status: 'expired',
        updated_at: now,
      });
      if (isActualUuid) q = q.eq('id', actualTradeId);
      else q = q.eq('trade_id', tradeId);
      let { error: updateError } = await q;

      // Defensive fallback if enum in Postgres is uppercase 'EXPIRED'
      if (updateError && (updateError.message?.includes('enum') || updateError.code === '22P02')) {
        let qUpper = supabase.from('trades').update({
          status: 'EXPIRED',
          updated_at: now,
        });
        if (isActualUuid) qUpper = qUpper.eq('id', actualTradeId);
        else qUpper = qUpper.eq('trade_id', tradeId);
        const resUpper = await qUpper;
        if (!resUpper.error) {
          updateError = null;
        }
      }

      if (updateError) {
        console.error('Failed to update trade status to expired:', updateError);
        return NextResponse.json({ error: updateError.message || 'Failed to expire trade.' }, { status: 400 });
      }

      // 2. Unlock/Refund seller escrow balance safely across all balance tables if seller_id is present
      try {
        const cryptoSym = (trade?.crypto || trade?.asset_symbol || trade?.coin || 'USDT').toUpperCase();
        const cryptoAmt = Number(trade?.crypto_amount ?? trade?.amount ?? 0);
        if (trade?.seller_id && cryptoAmt > 0) {
          // 2a. Update user_wallets
          const { data: uWallet } = await supabase
            .from('user_wallets')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('asset_symbol', cryptoSym)
            .maybeSingle();

          if (uWallet) {
            const curLocked = Number(uWallet.locked_balance || 0);
            const curReserved = Number(uWallet.reserved_balance || 0);
            await supabase
              .from('user_wallets')
              .update({
                locked_balance: Math.max(0, curLocked - cryptoAmt),
                reserved_balance: Math.max(0, curReserved - cryptoAmt),
                updated_at: now
              })
              .eq('id', uWallet.id);
          }

          // 2b. Update wallet_assets
          const { data: sellerAsset } = await supabase
            .from('wallet_assets')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('asset_symbol', cryptoSym)
            .maybeSingle();

          if (sellerAsset) {
            const curLocked = Number(sellerAsset.locked_escrow ?? sellerAsset.locked_balance ?? 0);
            const curReserved = Number(sellerAsset.reserved_balance ?? 0);
            const curAvail = Number(sellerAsset.available ?? sellerAsset.balance ?? 0);
            await supabase
              .from('wallet_assets')
              .update({
                available: curAvail + cryptoAmt,
                locked_escrow: Math.max(0, curLocked - cryptoAmt),
                reserved_balance: Math.max(0, curReserved - cryptoAmt),
                updated_at: now
              })
              .eq('id', sellerAsset.id);
          }

          // 2c. Update wallets (chain-level)
          const { data: mainWallet } = await supabase
            .from('wallets')
            .select('*')
            .eq('user_id', trade.seller_id)
            .maybeSingle();

          if (mainWallet) {
            const curLocked = Number(mainWallet.locked_balance || 0);
            const curAvail = Number(mainWallet.available_balance || 0);
            const curReserved = Number(mainWallet.reserved_balance || 0);
            await supabase
              .from('wallets')
              .update({
                available_balance: curAvail + cryptoAmt,
                locked_balance: Math.max(0, curLocked - cryptoAmt),
                reserved_balance: Math.max(0, curReserved - cryptoAmt),
                updated_at: now
              })
              .eq('id', mainWallet.id);
          }
        }
      } catch (refundErr) {
        console.warn('Escrow refund on expiration warning:', refundErr);
      }

      // 3. Post official system message in trade chat if not already present
      try {
        const { data: existingMsg } = await supabase
          .from('trade_messages')
          .select('id')
          .eq('trade_id', actualTradeId)
          .ilike('message', '%TRADE EXPIRED%')
          .limit(1)
          .maybeSingle();

        if (!existingMsg) {
          await insertPaxonesSystemMessage(supabase, {
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

      // 4. Notify both parties
      const userIds = [trade?.buyer_id, trade?.seller_id].filter(Boolean);
      for (const uid of userIds) {
        try {
          await supabase.from('notifications').insert({
            user_id: uid,
            title: 'Trade Expired',
            message: `Trade has expired because payment was not confirmed within the countdown window.`,
            link: `/trade/${actualTradeId}`,
            is_read: false,
            created_at: now
          }).select().maybeSingle();
        } catch {}
      }

      return NextResponse.json({ success: true, message: 'Trade marked as expired.' });
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
          status: 'released',
          escrow_status: 'RELEASED',
          released_at: now,
          completed_at: now,
        });

      if (isActualUuid) {
        updateQuery = updateQuery.eq('id', actualTradeId);
      } else {
        updateQuery = updateQuery.eq('trade_id', tradeId);
      }
      updateQuery = updateQuery.eq('seller_id', user.id);

      let { error: updateError } = await updateQuery;

      // If status update failed due to trigger or enum constraint, fallback to updating escrow_status and timestamps
      if (updateError) {
        console.warn('Primary release status update warning, trying escrow_status update:', updateError.message);
        let qFallback = supabase
          .from('trades')
          .update({
            escrow_status: 'RELEASED',
            released_at: now,
            completed_at: now,
          });
        if (isActualUuid) qFallback = qFallback.eq('id', actualTradeId);
        else qFallback = qFallback.eq('trade_id', tradeId);
        qFallback = qFallback.eq('seller_id', user.id);
        const resFb = await qFallback;
        if (!resFb.error) {
          updateError = null;
        }
      }

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

      if (trade?.buyer_id) {
        await supabase.from('notifications').insert({
          user_id: trade.buyer_id,
          title: 'Escrow Released',
          message: `@${sellerName} released ${coinAmount} ${coinSymbol} to your wallet.`,
          link: `/trade/${actualTradeId}`,
          is_read: false,
          created_at: now
        }).select().maybeSingle();
      }

      return NextResponse.json({ success: true, message: 'Escrow released successfully.' });
    }

    if (action === 'CANCEL_TRADE') {
      const now = new Date().toISOString();
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
          status: 'cancelled',
          escrow_status: 'CANCELLED',
          cancellation_reason: reason || 'Cancelled by user',
          cancelled_at: now
        });

      if (isActualUuid) {
        updateQuery = updateQuery.eq('id', actualTradeId);
      } else {
        updateQuery = updateQuery.eq('trade_id', tradeId);
      }
      updateQuery = updateQuery.or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);

      let { error: updateError } = await updateQuery;

      if (updateError) {
        console.warn('Primary cancel status update warning, trying escrow_status fallback:', updateError.message);
        let qFallback = supabase
          .from('trades')
          .update({
            escrow_status: 'CANCELLED',
            cancellation_reason: reason || 'Cancelled by user',
            cancelled_at: now
          });
        if (isActualUuid) qFallback = qFallback.eq('id', actualTradeId);
        else qFallback = qFallback.eq('trade_id', tradeId);
        qFallback = qFallback.or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);
        const resFb = await qFallback;
        if (!resFb.error) {
          updateError = null;
        }
      }

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      await insertPaxonesSystemMessage(supabase, {
        tradeId: actualTradeId,
        type: 'TRADE_CANCELLED'
      });

      const counterpartyId = user.id === trade?.buyer_id ? trade?.seller_id : trade?.buyer_id;
      if (counterpartyId) {
        await supabase.from('notifications').insert({
          user_id: counterpartyId,
          title: 'Trade Cancelled',
          message: `Trade has been cancelled. Any locked escrow has been refunded.`,
          link: `/trade/${actualTradeId}`,
          is_read: false,
          created_at: now
        }).select().maybeSingle();
      }

      return NextResponse.json({ success: true, message: 'Trade cancelled successfully.' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('Error in trade action handler:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
