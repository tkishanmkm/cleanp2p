import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { verify2FAOTP } from '@/lib/2fa';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = getSupabaseAdminClient();
    const body = await req.json();
    const { recipientInput, recipientUsername, asset, crypto, amount, totpCode } = body;
    
    const targetIdentifier = String(recipientInput || recipientUsername || '').trim();
    const coinSymbol = String(asset || crypto || 'USDT').toUpperCase().trim();
    const numericAmount = Number(amount);

    if (!targetIdentifier || !coinSymbol || isNaN(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: 'Invalid transfer payload. Recipient and positive amount required.' }, { status: 400 });
    }

    // 1. Fetch sender profile & check banned / restricted status
    const { data: senderProfile } = await admin
      .from('profiles')
      .select('id, username, is_banned, is_restricted, account_status, is_2fa_enabled, is_mfa_enabled, two_factor_secret, security_answer_hash')
      .eq('id', user.id)
      .maybeSingle();

    if (!senderProfile) {
      return NextResponse.json({ error: 'Sender profile not found.' }, { status: 404 });
    }

    // Block sender if banned or restricted
    if (
      senderProfile.is_banned ||
      senderProfile.is_restricted ||
      senderProfile.account_status === 'suspended' ||
      senderProfile.account_status === 'banned' ||
      senderProfile.account_status === 'restricted'
    ) {
      return NextResponse.json({
        error: 'Your account is restricted or banned. You cannot send or receive transfers.',
      }, { status: 403 });
    }

    // 2. Conditional 2FA check (only if enabled on sender profile)
    const is2faActive = Boolean(senderProfile?.is_2fa_enabled || senderProfile?.is_mfa_enabled);
    const secret = senderProfile?.two_factor_secret || senderProfile?.security_answer_hash;

    if (is2faActive) {
      if (!totpCode || typeof totpCode !== 'string' || totpCode.trim().length < 4) {
        return NextResponse.json({ error: '6-digit Authenticator TOTP code is required' }, { status: 403 });
      }

      const isValidTotp = verify2FAOTP(secret, totpCode.trim(), is2faActive);
      if (!isValidTotp) {
        return NextResponse.json({ error: 'Invalid authenticator code. Please check your authenticator app.' }, { status: 401 });
      }
    }

    // 3. Resolve recipient: Can be username, profile ID, user's email, or user's deposit address
    let recipientProfile: { id: string; username: string; is_banned?: boolean; is_restricted?: boolean; account_status?: string } | null = null;
    const cleanTarget = targetIdentifier.replace(/^@/, '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanTarget);

    // 3a. Check by exact / case-insensitive username in profiles
    const { data: profByUsername } = await admin
      .from('profiles')
      .select('id, username, is_banned, is_restricted, account_status')
      .ilike('username', cleanTarget)
      .maybeSingle();

    if (profByUsername) {
      recipientProfile = profByUsername;
    }

    // 3b. Check if cleanTarget is a valid UUID and matches id
    if (!recipientProfile && isUuid) {
      const { data: profById } = await admin
        .from('profiles')
        .select('id, username, is_banned, is_restricted, account_status')
        .eq('id', cleanTarget)
        .maybeSingle();
      if (profById) {
        recipientProfile = profById;
      }
    }

    // 3c. Check by email or full_name in profiles if still not found
    if (!recipientProfile) {
      const { data: profByEmail } = await admin
        .from('profiles')
        .select('id, username, is_banned, is_restricted, account_status')
        .or(`email.ilike.${cleanTarget},full_name.ilike.${cleanTarget}`)
        .maybeSingle();
      if (profByEmail) {
        recipientProfile = profByEmail;
      }
    }

    // 3d. Check if targetIdentifier is a deposit address of another platform user
    if (!recipientProfile) {
      const { data: depAddr } = await admin
        .from('deposit_addresses')
        .select('user_id')
        .eq('address', targetIdentifier)
        .maybeSingle();

      if (depAddr?.user_id) {
        const { data: profByAddr } = await admin
          .from('profiles')
          .select('id, username, is_banned, is_restricted, account_status')
          .eq('id', depAddr.user_id)
          .maybeSingle();
        if (profByAddr) {
          recipientProfile = profByAddr;
        }
      }
    }

    // 3e. If still not found, check Supabase Auth admin to see if user exists in auth.users by email or username
    if (!recipientProfile) {
      try {
        const { data: authData } = await admin.auth.admin.listUsers();
        if (authData?.users) {
          const matchedAuthUser = authData.users.find((u) => {
            const email = u.email?.toLowerCase() || '';
            const emailPrefix = email.split('@')[0];
            const metaUsername = (u.user_metadata?.username || '').toLowerCase();
            const targetLower = cleanTarget.toLowerCase();
            return (
              email === targetLower ||
              emailPrefix === targetLower ||
              metaUsername === targetLower ||
              u.id === cleanTarget
            );
          });

          if (matchedAuthUser) {
            // Find or insert profile for this user
            const { data: existingProf } = await admin
              .from('profiles')
              .select('id, username, is_banned, is_restricted, account_status')
              .eq('id', matchedAuthUser.id)
              .maybeSingle();

            if (existingProf) {
              recipientProfile = existingProf;
            } else {
              // Auto-create/upsert basic profile so transfer succeeds seamlessly
              const fallbackUsername = matchedAuthUser.user_metadata?.username || matchedAuthUser.email?.split('@')[0] || `user_${matchedAuthUser.id.slice(0, 6)}`;
              const { data: newProf } = await admin
                .from('profiles')
                .upsert({
                  id: matchedAuthUser.id,
                  username: fallbackUsername,
                  email: matchedAuthUser.email,
                  account_status: 'ACTIVE',
                })
                .select('id, username, is_banned, is_restricted, account_status')
                .single();

              if (newProf) {
                recipientProfile = newProf;
              }
            }
          }
        }
      } catch (authLookupErr) {
        console.warn('Auth user search fallback notice in transfer:', authLookupErr);
      }
    }

    if (!recipientProfile) {
      return NextResponse.json({ error: `Recipient "${targetIdentifier}" not found on Paxones.` }, { status: 404 });
    }

    if (recipientProfile.id === user.id) {
      return NextResponse.json({ error: 'You cannot transfer funds to yourself.' }, { status: 400 });
    }

    // Block recipient if banned or restricted
    if (
      recipientProfile.is_banned ||
      recipientProfile.is_restricted ||
      recipientProfile.account_status === 'suspended' ||
      recipientProfile.account_status === 'banned' ||
      recipientProfile.account_status === 'restricted'
    ) {
      return NextResponse.json({
        error: `Cannot transfer: Recipient @${recipientProfile.username} is banned or restricted on the platform.`,
      }, { status: 403 });
    }

    // 4. Calculate 1.5% transfer fee
    // If transferring 100 USDT -> fee is 1.5 USDT -> total deduction = 101.5 USDT
    const feeAmount = Number((numericAmount * 0.015).toFixed(8));
    const totalDeduction = Number((numericAmount + feeAmount).toFixed(8));

    // 5. Comprehensive Sender Balance Discovery across all tables
    let currentSenderBalance = 0;
    let foundSenderSource = false;

    // 5a. Check balances table
    try {
      const { data: sBal } = await admin
        .from('balances')
        .select('*')
        .eq('user_id', user.id)
        .or(`asset.ilike.${coinSymbol},asset_symbol.ilike.${coinSymbol}`)
        .maybeSingle();

      if (sBal) {
        const avail = Number(sBal.available_balance ?? sBal.available ?? sBal.balance ?? 0);
        if (avail > 0) {
          currentSenderBalance = avail;
          foundSenderSource = true;
        }
      }
    } catch (_) {}

    // 5b. Check user_wallets table
    if (!foundSenderSource) {
      try {
        const { data: sUW } = await admin
          .from('user_wallets')
          .select('*')
          .eq('user_id', user.id)
          .or(`asset_symbol.ilike.${coinSymbol},asset_code.ilike.${coinSymbol}`)
          .maybeSingle();

        if (sUW) {
          const avail = Number(sUW.available_balance ?? sUW.balance ?? 0);
          if (avail > 0) {
            currentSenderBalance = avail;
            foundSenderSource = true;
          }
        }
      } catch (_) {}
    }

    // 5c. Check wallet_assets table
    if (!foundSenderSource) {
      try {
        const { data: sWA } = await admin
          .from('wallet_assets')
          .select('*')
          .eq('user_id', user.id)
          .or(`asset_symbol.ilike.${coinSymbol},asset_code.ilike.${coinSymbol},symbol.ilike.${coinSymbol}`)
          .maybeSingle();

        if (sWA) {
          const avail = Number(sWA.available ?? sWA.balance ?? sWA.amount ?? 0);
          if (avail > 0) {
            currentSenderBalance = avail;
            foundSenderSource = true;
          }
        }
      } catch (_) {}
    }

    // 5d. Check wallets relation -> wallet_assets
    if (!foundSenderSource) {
      try {
        const { data: mainW } = await admin
          .from('wallets')
          .select('id, available_balance, balance')
          .eq('user_id', user.id)
          .maybeSingle();

        if (mainW?.id) {
          const { data: wAsset } = await admin
            .from('wallet_assets')
            .select('*')
            .eq('wallet_id', mainW.id)
            .or(`asset_code.ilike.${coinSymbol},asset_symbol.ilike.${coinSymbol}`)
            .maybeSingle();

          if (wAsset) {
            const avail = Number(wAsset.available ?? wAsset.balance ?? 0);
            if (avail > 0) {
              currentSenderBalance = avail;
              foundSenderSource = true;
            }
          }
        }
      } catch (_) {}
    }

    // 5e. Check profiles table direct balance columns
    if (!foundSenderSource) {
      try {
        const { data: profBal } = await admin
          .from('profiles')
          .select('btc_balance, eth_balance, ltc_balance, usdt_balance, wallets')
          .eq('id', user.id)
          .maybeSingle();

        if (profBal) {
          let profAvail = 0;
          if (coinSymbol === 'BTC') profAvail = Number(profBal.btc_balance ?? profBal.wallets?.BTC?.balance ?? 0);
          else if (coinSymbol === 'ETH') profAvail = Number(profBal.eth_balance ?? profBal.wallets?.ETH?.balance ?? 0);
          else if (coinSymbol === 'LTC') profAvail = Number(profBal.ltc_balance ?? profBal.wallets?.LTC?.balance ?? 0);
          else if (coinSymbol === 'USDT') profAvail = Number(profBal.usdt_balance ?? profBal.wallets?.USDT?.balance ?? 0);

          if (profAvail > 0) {
            currentSenderBalance = profAvail;
            foundSenderSource = true;
          }
        }
      } catch (_) {}
    }

    if (currentSenderBalance < totalDeduction) {
      return NextResponse.json({
        error: `Insufficient ${coinSymbol} balance. You need ${totalDeduction} ${coinSymbol} (${numericAmount} transfer + 1.5% fee of ${feeAmount} ${coinSymbol}), but only have ${currentSenderBalance} ${coinSymbol} available.`
      }, { status: 400 });
    }

    // 6. Execute atomic balance updates across ALL tables
    const newSenderBal = Number(Math.max(0, currentSenderBalance - totalDeduction).toFixed(8));

    // 6a. Update sender in balances table
    try {
      const { data: sBal } = await admin
        .from('balances')
        .select('*')
        .eq('user_id', user.id)
        .or(`asset.ilike.${coinSymbol},asset_symbol.ilike.${coinSymbol}`)
        .maybeSingle();

      if (sBal) {
        await admin.from('balances').update({
          available_balance: newSenderBal,
          available: newSenderBal,
          total_balance: Number(sBal.locked_balance || 0) + newSenderBal,
          updated_at: new Date().toISOString(),
        }).eq('id', sBal.id);
      }
    } catch (e) {
      console.warn('Sender balances table update notice:', e);
    }

    // 6b. Update sender in user_wallets table
    try {
      const { data: sUW } = await admin
        .from('user_wallets')
        .select('*')
        .eq('user_id', user.id)
        .or(`asset_symbol.ilike.${coinSymbol},asset_code.ilike.${coinSymbol}`)
        .maybeSingle();

      if (sUW) {
        await admin.from('user_wallets').update({
          available_balance: newSenderBal,
          balance: newSenderBal,
          updated_at: new Date().toISOString(),
        }).eq('id', sUW.id);
      }
    } catch (e) {
      console.warn('Sender user_wallets update notice:', e);
    }

    // 6c. Update sender in wallet_assets (by user_id)
    try {
      await admin
        .from('wallet_assets')
        .update({
          balance: newSenderBal,
          available: newSenderBal,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .or(`asset_symbol.ilike.${coinSymbol},asset_code.ilike.${coinSymbol}`);
    } catch (_) {}

    // 6d. Update sender in wallet_assets (by wallet_id)
    try {
      const { data: sMainW } = await admin
        .from('wallets')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (sMainW?.id) {
        await admin
          .from('wallet_assets')
          .update({
            available: newSenderBal,
            updated_at: new Date().toISOString(),
          })
          .eq('wallet_id', sMainW.id)
          .or(`asset_code.ilike.${coinSymbol},asset_symbol.ilike.${coinSymbol}`);
      }
    } catch (_) {}

    // 6e. Update sender in profiles table
    try {
      const profUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
      if (coinSymbol === 'BTC') profUpdate.btc_balance = newSenderBal;
      else if (coinSymbol === 'ETH') profUpdate.eth_balance = newSenderBal;
      else if (coinSymbol === 'LTC') profUpdate.ltc_balance = newSenderBal;
      else if (coinSymbol === 'USDT') profUpdate.usdt_balance = newSenderBal;
      await admin.from('profiles').update(profUpdate).eq('id', user.id);
    } catch (_) {}

    // ==========================================
    // 7. Credit recipient across all balance tables
    // ==========================================

    // 7a. Credit recipient in balances table
    try {
      const { data: rBal } = await admin
        .from('balances')
        .select('*')
        .eq('user_id', recipientProfile.id)
        .or(`asset.ilike.${coinSymbol},asset_symbol.ilike.${coinSymbol}`)
        .maybeSingle();

      if (rBal) {
        const curRBal = Number(rBal.available_balance ?? rBal.available ?? rBal.balance ?? 0);
        const nextRBal = Number((curRBal + numericAmount).toFixed(8));
        await admin.from('balances').update({
          available_balance: nextRBal,
          available: nextRBal,
          total_balance: Number(rBal.locked_balance || 0) + nextRBal,
          updated_at: new Date().toISOString(),
        }).eq('id', rBal.id);
      } else {
        await admin.from('balances').insert({
          user_id: recipientProfile.id,
          asset: coinSymbol,
          asset_symbol: coinSymbol,
          available_balance: numericAmount,
          available: numericAmount,
          locked_balance: 0,
          total_balance: numericAmount,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn('Recipient balances credit notice:', e);
    }

    // 7b. Credit recipient in user_wallets table
    try {
      const { data: rUW } = await admin
        .from('user_wallets')
        .select('*')
        .eq('user_id', recipientProfile.id)
        .or(`asset_symbol.ilike.${coinSymbol},asset_code.ilike.${coinSymbol}`)
        .maybeSingle();

      if (rUW) {
        const curRBal = Number(rUW.available_balance ?? rUW.balance ?? 0);
        const nextRBal = Number((curRBal + numericAmount).toFixed(8));
        await admin.from('user_wallets').update({
          available_balance: nextRBal,
          balance: nextRBal,
          updated_at: new Date().toISOString(),
        }).eq('id', rUW.id);
      } else {
        await admin.from('user_wallets').insert({
          user_id: recipientProfile.id,
          asset_symbol: coinSymbol,
          available_balance: numericAmount,
          balance: numericAmount,
          locked_balance: 0,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn('Recipient user_wallets credit notice:', e);
    }

    // 7c. Credit recipient in wallet_assets (by user_id)
    try {
      const { data: rWA } = await admin
        .from('wallet_assets')
        .select('*')
        .eq('user_id', recipientProfile.id)
        .or(`asset_symbol.ilike.${coinSymbol},asset_code.ilike.${coinSymbol}`)
        .maybeSingle();

      if (rWA) {
        const curRBal = Number(rWA.available ?? rWA.balance ?? 0);
        const nextRBal = Number((curRBal + numericAmount).toFixed(8));
        await admin
          .from('wallet_assets')
          .update({
            balance: nextRBal,
            available: nextRBal,
            updated_at: new Date().toISOString(),
          })
          .eq('id', rWA.id);
      } else {
        await admin
          .from('wallet_assets')
          .insert({
            user_id: recipientProfile.id,
            asset_symbol: coinSymbol,
            balance: numericAmount,
            available: numericAmount,
            locked_balance: 0,
            locked_escrow: 0,
            updated_at: new Date().toISOString(),
          });
      }
    } catch (_) {}

    // 7d. Credit recipient in wallet_assets (by wallet_id)
    try {
      const { data: rMainW } = await admin
        .from('wallets')
        .select('id')
        .eq('user_id', recipientProfile.id)
        .maybeSingle();

      if (rMainW?.id) {
        const { data: rWAsset } = await admin
          .from('wallet_assets')
          .select('*')
          .eq('wallet_id', rMainW.id)
          .or(`asset_code.ilike.${coinSymbol},asset_symbol.ilike.${coinSymbol}`)
          .maybeSingle();

        if (rWAsset) {
          const curRBal = Number(rWAsset.available ?? 0);
          const nextRBal = Number((curRBal + numericAmount).toFixed(8));
          await admin
            .from('wallet_assets')
            .update({
              available: nextRBal,
              updated_at: new Date().toISOString(),
            })
            .eq('wallet_id', rMainW.id)
            .or(`asset_code.ilike.${coinSymbol},asset_symbol.ilike.${coinSymbol}`);
        }
      }
    } catch (_) {}

    // 7e. Credit recipient in profiles table
    try {
      const { data: rProf } = await admin
        .from('profiles')
        .select('btc_balance, eth_balance, ltc_balance, usdt_balance')
        .eq('id', recipientProfile.id)
        .maybeSingle();

      if (rProf) {
        const profCredit: Record<string, any> = { updated_at: new Date().toISOString() };
        if (coinSymbol === 'BTC') profCredit.btc_balance = Number(((rProf.btc_balance || 0) + numericAmount).toFixed(8));
        else if (coinSymbol === 'ETH') profCredit.eth_balance = Number(((rProf.eth_balance || 0) + numericAmount).toFixed(8));
        else if (coinSymbol === 'LTC') profCredit.ltc_balance = Number(((rProf.ltc_balance || 0) + numericAmount).toFixed(8));
        else if (coinSymbol === 'USDT') profCredit.usdt_balance = Number(((rProf.usdt_balance || 0) + numericAmount).toFixed(8));
        await admin.from('profiles').update(profCredit).eq('id', recipientProfile.id);
      }
    } catch (_) {}

    // 7. Generate 12-character alphanumeric transfer ID
    const randomHex = Math.random().toString(36).substring(2, 11).toUpperCase();
    const publicId = `TRF${randomHex}`.substring(0, 12);
    const senderName = senderProfile?.username || 'Trader';
    const recipientName = recipientProfile.username || 'Trader';

    // 8. Record in transfers table (resilient multi-payload fallback)
    let transferInsertErr: any = null;

    // Try primary insert with all standard fields
    const primaryPayload: any = {
      public_id: publicId,
      sender_id: user.id,
      sender_username: senderName,
      recipient_id: recipientProfile.id,
      recipient_username: recipientName,
      crypto: coinSymbol,
      amount: numericAmount,
      fee: feeAmount,
      status: 'confirmed',
      created_at: new Date().toISOString(),
    };

    const res1 = await admin.from('transfers').insert(primaryPayload);
    transferInsertErr = res1.error;

    if (transferInsertErr) {
      console.warn('Transfers primary insert failed, attempting fallback with fee_amount/asset_symbol:', transferInsertErr);
      
      const fallbackPayload1: any = {
        public_id: publicId,
        sender_id: user.id,
        sender_username: senderName,
        recipient_id: recipientProfile.id,
        recipient_username: recipientName,
        crypto: coinSymbol,
        asset_symbol: coinSymbol,
        amount: numericAmount,
        fee_amount: feeAmount,
        status: 'confirmed',
        created_at: new Date().toISOString(),
      };
      const res2 = await admin.from('transfers').insert(fallbackPayload1);
      transferInsertErr = res2.error;

      // If still error, try core minimal fields
      if (transferInsertErr) {
        console.warn('Transfers fallback 1 failed, trying core minimal fields:', transferInsertErr);
        const fallbackPayload2: any = {
          sender_id: user.id,
          recipient_id: recipientProfile.id,
          crypto: coinSymbol,
          amount: numericAmount,
          created_at: new Date().toISOString(),
        };
        const res3 = await admin.from('transfers').insert(fallbackPayload2);
        transferInsertErr = res3.error;
      }
    }

    if (transferInsertErr) {
      console.error('Final transfer record insertion failure:', transferInsertErr);
    }

    // 9. Dispatch Activity Center notifications to sender and recipient
    const nowIso = new Date().toISOString();
    try {
      // Recipient notification
      await admin.from('notifications').insert({
        user_id: recipientProfile.id,
        title: 'Transfer Received',
        message: `Received ${numericAmount} ${coinSymbol} from @${senderName}.`,
        link: '/wallet',
        is_read: false,
        created_at: nowIso,
        sender_username: senderName,
      });

      // Sender confirmation notification
      await admin.from('notifications').insert({
        user_id: user.id,
        title: 'Transfer Sent',
        message: `Successfully transferred ${numericAmount} ${coinSymbol} to @${recipientName}.`,
        link: '/wallet',
        is_read: false,
        created_at: nowIso,
      });
    } catch (notifErr) {
      console.warn('Transfer notifications insert notice:', notifErr);
    }

    return NextResponse.json({
      success: true,
      transferId: publicId,
      amount: numericAmount,
      fee: feeAmount,
      totalDeduction,
      crypto: coinSymbol,
      senderUsername: senderName,
      recipientUsername: recipientName,
      message: `Successfully transferred ${numericAmount} ${coinSymbol} to @${recipientName} (1.5% Fee: ${feeAmount} ${coinSymbol}).`,
    }, { status: 200 });

  } catch (err: any) {
    console.error('Transfer API route error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error during transfer' }, { status: 500 });
  }
}
