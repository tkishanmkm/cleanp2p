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

      // Try RPC first
      let rpcSucceeded = false;
      try {
        const { data: rpcData, error: rpcError } = await adminClient.rpc('expire_p2p_trade', {
          p_trade_id: actualTradeId,
        });
        if (!rpcError && rpcData?.success) {
          rpcSucceeded = true;
        }
      } catch (e) {
        console.warn('expire_p2p_trade RPC call warning:', e);
      }

      if (!rpcSucceeded) {
        // 1. Update trade status to 'expired'
        let q = adminClient.from('trades').update({
          status: 'expired',
          escrow_status: 'EXPIRED',
          updated_at: now,
        });
        if (isActualUuid) q = q.eq('id', actualTradeId);
        else q = q.eq('trade_id', tradeId);
        let { error: updateError } = await q;

        // Defensive fallback 1: Uppercase 'EXPIRED'
        if (updateError) {
          let qUpper = adminClient.from('trades').update({
            status: 'EXPIRED',
            escrow_status: 'EXPIRED',
            updated_at: now,
          });
          if (isActualUuid) qUpper = qUpper.eq('id', actualTradeId);
          else qUpper = qUpper.eq('trade_id', tradeId);
          const resUpper = await qUpper;
          if (!resUpper.error) {
            updateError = null;
          }
        }

        // Defensive fallback 2: 'cancelled' / 'CANCELLED' if 'expired' is not in enum
        if (updateError) {
          let qCancelled = adminClient.from('trades').update({
            status: 'cancelled',
            escrow_status: 'EXPIRED',
            updated_at: now,
          });
          if (isActualUuid) qCancelled = qCancelled.eq('id', actualTradeId);
          else qCancelled = qCancelled.eq('trade_id', tradeId);
          const resCancelled = await qCancelled;
          if (!resCancelled.error) {
            updateError = null;
          }
        }

        // Defensive fallback 3: Update escrow_status and timestamp only
        if (updateError) {
          let qEscrowOnly = adminClient.from('trades').update({
            escrow_status: 'EXPIRED',
            updated_at: now,
          });
          if (isActualUuid) qEscrowOnly = qEscrowOnly.eq('id', actualTradeId);
          else qEscrowOnly = qEscrowOnly.eq('trade_id', tradeId);
          const resEscrow = await qEscrowOnly;
          if (!resEscrow.error) {
            updateError = null;
          }
        }

        if (updateError) {
          console.error('Failed to update trade status to expired:', updateError);
          return NextResponse.json({ error: updateError.message || 'Failed to expire trade.' }, { status: 400 });
        }
      }

      // Also sync p2p_trades if applicable
      try {
        await adminClient
          .from('p2p_trades')
          .update({ status: 'EXPIRED', updated_at: now })
          .eq('id', actualTradeId);
      } catch (_) {}

      // 2. Unlock/Refund seller escrow balance safely across all balance tables if seller_id is present
      try {
        const cryptoSym = (trade?.crypto || trade?.asset_symbol || trade?.coin || 'USDT').toUpperCase();
        const cryptoAmt = Number(trade?.crypto_amount ?? trade?.amount ?? 0);
        if (trade?.seller_id && cryptoAmt > 0) {
          // 2a. Update user_wallets
          const { data: uWallet } = await adminClient
            .from('user_wallets')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('asset_symbol', cryptoSym)
            .maybeSingle();

          if (uWallet) {
            const curLocked = Number(uWallet.locked_balance || 0);
            const curReserved = Number(uWallet.reserved_balance || 0);
            await adminClient
              .from('user_wallets')
              .update({
                locked_balance: Math.max(0, curLocked - cryptoAmt),
                reserved_balance: Math.max(0, curReserved - cryptoAmt),
                updated_at: now
              })
              .eq('id', uWallet.id);
          }

          // 2b. Update wallet_assets
          const { data: sellerAsset } = await adminClient
            .from('wallet_assets')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('asset_symbol', cryptoSym)
            .maybeSingle();

          if (sellerAsset) {
            const curLocked = Number(sellerAsset.locked_escrow ?? sellerAsset.locked_balance ?? 0);
            const curReserved = Number(sellerAsset.reserved_balance ?? 0);
            const curAvail = Number(sellerAsset.available ?? sellerAsset.balance ?? 0);
            await adminClient
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
          const { data: mainWallet } = await adminClient
            .from('wallets')
            .select('*')
            .eq('user_id', trade.seller_id)
            .maybeSingle();

          if (mainWallet) {
            const curLocked = Number(mainWallet.locked_balance || 0);
            const curAvail = Number(mainWallet.available_balance || 0);
            const curReserved = Number(mainWallet.reserved_balance || 0);
            await adminClient
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

      // 4. Notify both parties
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

      return NextResponse.json({ success: true, message: 'Trade marked as expired.' });
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

      let rpcSucceeded = false;
      let rpcResult: any = null;

      try {
        const { data, error } = await adminClient.rpc('release_trade_escrow', {
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
      let updateQuery = adminClient
        .from('trades')
        .update({
          status: 'released',
          escrow_status: 'RELEASED',
          released_at: now,
          completed_at: now,
          updated_at: now
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
        let qFallback = adminClient
          .from('trades')
          .update({
            escrow_status: 'RELEASED',
            released_at: now,
            completed_at: now,
            updated_at: now
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
      const coinSymbol = (trade?.crypto ?? trade?.asset_symbol ?? 'USDT').toUpperCase();
      const feeAmount = Number(trade?.escrow_fee ?? trade?.platform_fee ?? (coinAmount * 0.015));
      const totalSellerDeduct = coinAmount + feeAmount;

      // 1. Deduct seller locked escrow across tables
      try {
        if (trade?.seller_id && totalSellerDeduct > 0) {
          // Table: balances
          const { data: sBal } = await adminClient
            .from('balances')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('asset', coinSymbol)
            .maybeSingle();

          if (sBal) {
            await adminClient
              .from('balances')
              .update({
                locked_balance: Math.max(0, Number(sBal.locked_balance || 0) - totalSellerDeduct),
                total_balance: Math.max(0, Number(sBal.total_balance || 0) - totalSellerDeduct),
                updated_at: now
              })
              .eq('id', sBal.id);
          }

          // Table: user_balances
          const { data: sUBal } = await adminClient
            .from('user_balances')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('asset', coinSymbol)
            .maybeSingle();

          if (sUBal) {
            await adminClient
              .from('user_balances')
              .update({
                locked_balance: Math.max(0, Number(sUBal.locked_balance || 0) - totalSellerDeduct),
                updated_at: now
              })
              .eq('id', sUBal.id);
          }

          // Table: user_wallets
          const { data: sUW } = await adminClient
            .from('user_wallets')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('asset_symbol', coinSymbol)
            .maybeSingle();

          if (sUW) {
            await adminClient
              .from('user_wallets')
              .update({
                locked_balance: Math.max(0, Number(sUW.locked_balance || 0) - totalSellerDeduct),
                reserved_balance: Math.max(0, Number(sUW.reserved_balance || 0) - totalSellerDeduct),
                balance: Math.max(0, Number(sUW.balance || 0) - totalSellerDeduct),
                updated_at: now
              })
              .eq('id', sUW.id);
          }

          // Table: wallet_assets
          const { data: sWA } = await adminClient
            .from('wallet_assets')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('asset_symbol', coinSymbol)
            .maybeSingle();

          if (sWA) {
            await adminClient
              .from('wallet_assets')
              .update({
                locked_escrow: Math.max(0, Number(sWA.locked_escrow ?? sWA.locked_balance ?? 0) - totalSellerDeduct),
                locked_balance: Math.max(0, Number(sWA.locked_balance ?? sWA.locked_escrow ?? 0) - totalSellerDeduct),
                reserved_balance: Math.max(0, Number(sWA.reserved_balance || 0) - totalSellerDeduct),
                updated_at: now
              })
              .eq('id', sWA.id);
          }

          // Table: wallets
          const { data: sW } = await adminClient
            .from('wallets')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('currency', coinSymbol)
            .maybeSingle();

          if (sW) {
            await adminClient
              .from('wallets')
              .update({
                locked_balance: Math.max(0, Number(sW.locked_balance || 0) - totalSellerDeduct),
                total_balance: Math.max(0, Number(sW.total_balance || 0) - totalSellerDeduct),
                updated_at: now
              })
              .eq('id', sW.id);
          }
        }

        // 2. Credit buyer available balance across tables
        if (trade?.buyer_id && coinAmount > 0) {
          // Table: balances
          const { data: bBal } = await adminClient
            .from('balances')
            .select('*')
            .eq('user_id', trade.buyer_id)
            .ilike('asset', coinSymbol)
            .maybeSingle();

          if (bBal) {
            await adminClient
              .from('balances')
              .update({
                available_balance: Number(bBal.available_balance || 0) + coinAmount,
                total_balance: Number(bBal.total_balance || 0) + coinAmount,
                updated_at: now
              })
              .eq('id', bBal.id);
          } else {
            await adminClient.from('balances').insert({
              user_id: trade.buyer_id,
              asset: coinSymbol,
              available_balance: coinAmount,
              locked_balance: 0,
              total_balance: coinAmount,
              updated_at: now
            });
          }

          // Table: user_balances
          const { data: bUBal } = await adminClient
            .from('user_balances')
            .select('*')
            .eq('user_id', trade.buyer_id)
            .ilike('asset', coinSymbol)
            .maybeSingle();

          if (bUBal) {
            await adminClient
              .from('user_balances')
              .update({
                available_balance: Number(bUBal.available_balance || 0) + coinAmount,
                updated_at: now
              })
              .eq('id', bUBal.id);
          } else {
            await adminClient.from('user_balances').insert({
              user_id: trade.buyer_id,
              asset: coinSymbol,
              available_balance: coinAmount,
              locked_balance: 0,
              updated_at: now
            });
          }

          // Table: user_wallets
          const { data: bUW } = await adminClient
            .from('user_wallets')
            .select('*')
            .eq('user_id', trade.buyer_id)
            .ilike('asset_symbol', coinSymbol)
            .maybeSingle();

          if (bUW) {
            await adminClient
              .from('user_wallets')
              .update({
                available_balance: Number(bUW.available_balance || 0) + coinAmount,
                balance: Number(bUW.balance || 0) + coinAmount,
                updated_at: now
              })
              .eq('id', bUW.id);
          } else {
            await adminClient
              .from('user_wallets')
              .insert({
                user_id: trade.buyer_id,
                asset_symbol: coinSymbol,
                available_balance: coinAmount,
                locked_balance: 0,
                balance: coinAmount,
                created_at: now,
                updated_at: now
              });
          }

          // Table: wallet_assets
          const { data: bWA } = await adminClient
            .from('wallet_assets')
            .select('*')
            .eq('user_id', trade.buyer_id)
            .ilike('asset_symbol', coinSymbol)
            .maybeSingle();

          if (bWA) {
            await adminClient
              .from('wallet_assets')
              .update({
                available: Number(bWA.available ?? bWA.balance ?? 0) + coinAmount,
                updated_at: now
              })
              .eq('id', bWA.id);
          } else {
            await adminClient
              .from('wallet_assets')
              .insert({
                user_id: trade.buyer_id,
                asset_symbol: coinSymbol,
                available: coinAmount,
                locked_escrow: 0,
                locked_balance: 0,
                updated_at: now
              });
          }

          // Table: wallets
          const { data: bW } = await adminClient
            .from('wallets')
            .select('*')
            .eq('user_id', trade.buyer_id)
            .ilike('currency', coinSymbol)
            .maybeSingle();

          if (bW) {
            await adminClient
              .from('wallets')
              .update({
                total_balance: Number(bW.total_balance || 0) + coinAmount,
                updated_at: now
              })
              .eq('id', bW.id);
          }
        }

        // 3. Increment completed_trades in profiles
        if (trade?.seller_id) {
          const { data: sP } = await adminClient.from('profiles').select('completed_trades').eq('id', trade.seller_id).maybeSingle();
          await adminClient.from('profiles').update({ completed_trades: (sP?.completed_trades || 0) + 1 }).eq('id', trade.seller_id);
        }
        if (trade?.buyer_id) {
          const { data: bP } = await adminClient.from('profiles').select('completed_trades').eq('id', trade.buyer_id).maybeSingle();
          await adminClient.from('profiles').update({ completed_trades: (bP?.completed_trades || 0) + 1 }).eq('id', trade.buyer_id);
        }

        // 4. If dispute existed, mark resolved
        await adminClient
          .from('disputes')
          .update({
            status: 'RESOLVED',
            admin_decision: 'RELEASE_BUYER',
            resolved_at: now
          })
          .eq('trade_id', actualTradeId);
      } catch (balErr) {
        console.warn('Balance sync on escrow release warning:', balErr);
      }

      await insertPaxonesSystemMessage(adminClient, {
        tradeId: actualTradeId,
        type: 'TRADE_COMPLETED',
        sellerUsername: sellerName,
        buyerUsername: buyerName,
        coinAmount,
        coinSymbol
      });

      if (trade?.buyer_id) {
        await adminClient.from('notifications').insert({
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
        const { data, error } = await adminClient.rpc('cancel_p2p_trade', {
          p_trade_id: actualTradeId,
          p_user_id: user.id,
          p_reason: reason || 'Cancelled by buyer',
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
      let updateQuery = adminClient
        .from('trades')
        .update({
          status: 'cancelled',
          escrow_status: 'CANCELLED',
          cancellation_reason: reason || 'Cancelled by user',
          cancelled_at: now,
          updated_at: now
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
        let qFallback = adminClient
          .from('trades')
          .update({
            escrow_status: 'CANCELLED',
            cancellation_reason: reason || 'Cancelled by user',
            cancelled_at: now,
            updated_at: now
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

      // Refund locked funds back to seller available balance
      const coinAmount = Number(trade?.amount ?? trade?.crypto_amount ?? 0);
      const coinSymbol = (trade?.crypto ?? trade?.asset_symbol ?? 'USDT').toUpperCase();
      const feeAmount = Number(trade?.escrow_fee ?? trade?.platform_fee ?? (coinAmount * 0.015));
      const totalRefund = coinAmount + feeAmount;

      try {
        if (trade?.seller_id && totalRefund > 0) {
          // Table: balances
          const { data: sBal } = await adminClient
            .from('balances')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('asset', coinSymbol)
            .maybeSingle();

          if (sBal) {
            await adminClient
              .from('balances')
              .update({
                available_balance: Number(sBal.available_balance || 0) + totalRefund,
                locked_balance: Math.max(0, Number(sBal.locked_balance || 0) - totalRefund),
                updated_at: now
              })
              .eq('id', sBal.id);
          }

          // Table: user_balances
          const { data: sUBal } = await adminClient
            .from('user_balances')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('asset', coinSymbol)
            .maybeSingle();

          if (sUBal) {
            await adminClient
              .from('user_balances')
              .update({
                available_balance: Number(sUBal.available_balance || 0) + totalRefund,
                locked_balance: Math.max(0, Number(sUBal.locked_balance || 0) - totalRefund),
                updated_at: now
              })
              .eq('id', sUBal.id);
          }

          // Table: user_wallets
          const { data: sUW } = await adminClient
            .from('user_wallets')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('asset_symbol', coinSymbol)
            .maybeSingle();

          if (sUW) {
            await adminClient
              .from('user_wallets')
              .update({
                available_balance: Number(sUW.available_balance || sUW.balance || 0) + totalRefund,
                locked_balance: Math.max(0, Number(sUW.locked_balance || 0) - totalRefund),
                reserved_balance: Math.max(0, Number(sUW.reserved_balance || 0) - totalRefund),
                updated_at: now
              })
              .eq('id', sUW.id);
          }

          // Table: wallet_assets
          const { data: sWA } = await adminClient
            .from('wallet_assets')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('asset_symbol', coinSymbol)
            .maybeSingle();

          if (sWA) {
            await adminClient
              .from('wallet_assets')
              .update({
                available: Number(sWA.available ?? sWA.balance ?? 0) + totalRefund,
                locked_escrow: Math.max(0, Number(sWA.locked_escrow ?? sWA.locked_balance ?? 0) - totalRefund),
                locked_balance: Math.max(0, Number(sWA.locked_balance ?? sWA.locked_escrow ?? 0) - totalRefund),
                reserved_balance: Math.max(0, Number(sWA.reserved_balance || 0) - totalRefund),
                updated_at: now
              })
              .eq('id', sWA.id);
          }

          // Table: wallets
          const { data: sW } = await adminClient
            .from('wallets')
            .select('*')
            .eq('user_id', trade.seller_id)
            .ilike('currency', coinSymbol)
            .maybeSingle();

          if (sW) {
            await adminClient
              .from('wallets')
              .update({
                locked_balance: Math.max(0, Number(sW.locked_balance || 0) - totalRefund),
                updated_at: now
              })
              .eq('id', sW.id);
          }
        }

        // Close any active dispute
        await adminClient
          .from('disputes')
          .update({
            status: 'CLOSED',
            admin_decision: 'REFUND_SELLER',
            resolved_at: now
          })
          .eq('trade_id', actualTradeId);
      } catch (balErr) {
        console.warn('Balance refund on trade cancel warning:', balErr);
      }

      await insertPaxonesSystemMessage(adminClient, {
        tradeId: actualTradeId,
        type: 'TRADE_CANCELLED'
      });

      const counterpartyId = user.id === trade?.buyer_id ? trade?.seller_id : trade?.buyer_id;
      if (counterpartyId) {
        await adminClient.from('notifications').insert({
          user_id: counterpartyId,
          title: 'Trade Cancelled',
          message: `Trade has been cancelled. Any locked escrow has been refunded to the seller.`,
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
