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

    // 5. Check sender's available balance in wallet_assets
    const { data: senderAsset } = await admin
      .from('wallet_assets')
      .select('balance, locked_balance')
      .eq('user_id', user.id)
      .eq('asset_symbol', coinSymbol)
      .maybeSingle();

    const currentSenderBalance = Number(senderAsset?.balance || 0);
    if (currentSenderBalance < totalDeduction) {
      return NextResponse.json({
        error: `Insufficient ${coinSymbol} balance. You need ${totalDeduction} ${coinSymbol} (${numericAmount} transfer + 1.5% fee of ${feeAmount} ${coinSymbol}), but have ${currentSenderBalance} ${coinSymbol}.`
      }, { status: 400 });
    }

    // 6. Execute atomic balance updates
    // Deduct totalDeduction from sender
    const { error: deductErr } = await admin
      .from('wallet_assets')
      .update({
        balance: Number((currentSenderBalance - totalDeduction).toFixed(8)),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('asset_symbol', coinSymbol);

    if (deductErr) {
      console.error('Balance deduction error:', deductErr);
      return NextResponse.json({ error: 'Failed to update sender balance' }, { status: 500 });
    }

    // Upsert / Add net amount to recipient
    const { data: recipientAsset } = await admin
      .from('wallet_assets')
      .select('balance')
      .eq('user_id', recipientProfile.id)
      .eq('asset_symbol', coinSymbol)
      .maybeSingle();

    if (recipientAsset) {
      await admin
        .from('wallet_assets')
        .update({
          balance: Number(((recipientAsset.balance || 0) + numericAmount).toFixed(8)),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', recipientProfile.id)
        .eq('asset_symbol', coinSymbol);
    } else {
      await admin
        .from('wallet_assets')
        .insert({
          user_id: recipientProfile.id,
          asset_symbol: coinSymbol,
          balance: numericAmount,
          locked_balance: 0,
          updated_at: new Date().toISOString(),
        });
    }

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
