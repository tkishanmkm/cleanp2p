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

    const { recipientUsername, asset, crypto, amount, totpCode } = await req.json();
    const coinSymbol = String(asset || crypto || '').toUpperCase().trim();
    const numericAmount = Number(amount);

    if (!recipientUsername || !coinSymbol || isNaN(numericAmount) || numericAmount <= 0) {
      return NextResponse.json({ error: 'Invalid transfer payload. Amount must be positive.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    // 1. Fetch sender profile
    const { data: senderProfile } = await admin
      .from('profiles')
      .select('id, username, is_2fa_enabled, is_mfa_enabled, two_factor_secret, security_answer_hash')
      .eq('id', user.id)
      .maybeSingle();

    // 2. Conditional 2FA check (only if enabled)
    const is2faActive = Boolean(senderProfile?.is_2fa_enabled || senderProfile?.is_mfa_enabled);
    const secret = senderProfile?.two_factor_secret || senderProfile?.security_answer_hash;

    if (is2faActive) {
      if (!totpCode || typeof totpCode !== 'string' || totpCode.trim().length < 4) {
        return NextResponse.json({ error: '6-digit Authenticator TOTP code is required' }, { status: 403 });
      }

      const isValidTotp = verify2FAOTP(secret, totpCode.trim(), is2faActive);

      if (!isValidTotp) {
        return NextResponse.json({ error: 'Invalid authenticator code. Please check your app.' }, { status: 401 });
      }
    }

    // 3. Find recipient by username or id
    const cleanRecipient = recipientUsername.trim().replace(/^@/, '');
    const { data: recipientProfile, error: recipientErr } = await admin
      .from('profiles')
      .select('id, username')
      .or(`username.ilike.${cleanRecipient},id.eq.${cleanRecipient}`)
      .maybeSingle();

    if (recipientErr || !recipientProfile) {
      return NextResponse.json({ error: `Recipient user "${recipientUsername}" not found.` }, { status: 404 });
    }

    if (recipientProfile.id === user.id) {
      return NextResponse.json({ error: 'You cannot transfer coins to yourself.' }, { status: 400 });
    }

    // 4. Check sender balance in wallet_assets
    const { data: senderAsset } = await admin
      .from('wallet_assets')
      .select('*')
      .eq('user_id', user.id)
      .eq('asset_symbol', coinSymbol)
      .maybeSingle();

    const senderAvailable = Number(senderAsset?.available ?? senderAsset?.balance ?? 0);

    if (senderAvailable < numericAmount) {
      return NextResponse.json({
        error: `Insufficient available ${coinSymbol} balance. Available: ${senderAvailable.toFixed(8)} ${coinSymbol}`,
      }, { status: 400 });
    }

    // 5. Debit sender available balance
    const newSenderAvailable = senderAvailable - numericAmount;
    await admin
      .from('wallet_assets')
      .upsert({
        user_id: user.id,
        asset_symbol: coinSymbol,
        available: newSenderAvailable,
        locked: Number(senderAsset?.locked ?? 0),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,asset_symbol' });

    // 6. Credit recipient available balance
    const { data: recipientAsset } = await admin
      .from('wallet_assets')
      .select('*')
      .eq('user_id', recipientProfile.id)
      .eq('asset_symbol', coinSymbol)
      .maybeSingle();

    const recipientAvailable = Number(recipientAsset?.available ?? recipientAsset?.balance ?? 0);
    const newRecipientAvailable = recipientAvailable + numericAmount;

    await admin
      .from('wallet_assets')
      .upsert({
        user_id: recipientProfile.id,
        asset_symbol: coinSymbol,
        available: newRecipientAvailable,
        locked: Number(recipientAsset?.locked ?? 0),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,asset_symbol' });

    // 7. Record transaction in transfers table
    const publicId = `TX-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    const senderName = senderProfile?.username || 'Trader';
    const recipientName = recipientProfile?.username || 'Trader';

    const { data: transferRecord, error: transferInsertErr } = await admin
      .from('transfers')
      .insert({
        public_id: publicId,
        sender_id: user.id,
        sender_username: senderName,
        recipient_id: recipientProfile.id,
        recipient_username: recipientName,
        crypto: coinSymbol,
        amount: numericAmount,
        status: 'completed',
        created_at: new Date().toISOString(),
      })
      .select()
      .maybeSingle();

    if (transferInsertErr) {
      console.warn('Transfer record insert notice:', transferInsertErr);
    }

    return NextResponse.json({
      success: true,
      transferId: publicId,
      amount: numericAmount,
      crypto: coinSymbol,
      senderUsername: senderName,
      recipientUsername: recipientName,
      message: `Successfully sent ${numericAmount} ${coinSymbol} to @${recipientName}`,
    }, { status: 200 });
  } catch (err: any) {
    console.error('Transfer route error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error during transfer' }, { status: 500 });
  }
}
