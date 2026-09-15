import { NextRequest, NextResponse } from 'next/server';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifySignature(body: string, signature: string, secret: string): boolean {
  try {
    const hmac = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const sigBuf = Buffer.from(signature);
    const hmacBuf = Buffer.from(hmac);
    if (sigBuf.length !== hmacBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, hmacBuf);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-alchemy-signature') ?? '';

    if (SYSTEM_CONFIG.secrets.webhook && !verifySignature(rawBody, signature, SYSTEM_CONFIG.secrets.webhook)) {
      return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody) as {
      event?: { activity?: Array<{ toAddress: string; value: number; asset: string; hash: string }> };
    };
    
    const activity = payload.event?.activity?.[0];

    if (!activity) {
      return NextResponse.json({ error: 'No activity data found' }, { status: 400 });
    }

    const toAddress = activity.toAddress.toLowerCase();
    const amount = activity.value;
    const asset = activity.asset;
    const txHash = activity.hash;

    // Address-to-User Lookup (supports profiles, user_deposit_addresses, and deposit_addresses)
    let userId: string | null = null;
    let walletIndex = 0;

    // 1. Check profiles table
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, wallet_index, evm_deposit_address, tron_deposit_address, btc_deposit_address, ltc_deposit_address')
      .or(`evm_deposit_address.ilike.${toAddress},tron_deposit_address.ilike.${toAddress},btc_deposit_address.ilike.${toAddress},ltc_deposit_address.ilike.${toAddress}`)
      .maybeSingle();

    if (profile?.id) {
      userId = profile.id;
      walletIndex = profile.wallet_index ?? 0;
    }

    // 2. Fallback to user_deposit_addresses
    if (!userId) {
      const { data: depositAddr } = await supabaseAdmin
        .from('user_deposit_addresses')
        .select('user_id, derivation_index')
        .filter('address', 'ilike', toAddress)
        .maybeSingle();

      if (depositAddr?.user_id) {
        userId = depositAddr.user_id;
        walletIndex = depositAddr.derivation_index ?? 0;
      }
    }

    // 3. Fallback to legacy deposit_addresses
    if (!userId) {
      const { data: legacyAddr } = await supabaseAdmin
        .from('deposit_addresses')
        .select('user_id')
        .filter('address', 'ilike', toAddress)
        .maybeSingle();

      if (legacyAddr?.user_id) {
        userId = legacyAddr.user_id;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Address does not belong to platform user' }, { status: 400 });
    }

    // Process deposit credit
    const { error: creditError } = await supabaseAdmin.rpc('process_user_deposit', {
      p_user_id: userId,
      p_amount: amount,
      p_asset: asset,
      p_tx_hash: txHash,
    });

    if (creditError) throw creditError;

    // Enqueue for automated sweeping
    await supabaseAdmin.from('sweep_queue').insert({
      user_id: userId,
      wallet_index: walletIndex,
      asset,
      deposit_address: toAddress,
      amount,
      tx_hash: txHash,
      status: asset === 'ETH' ? 'GAS_FUNDED' : 'PENDING_GAS',
    });

    return NextResponse.json({ success: true, message: 'Deposit processed' });
  } catch (err: any) {
    console.error('Webhook processing failed raw:', err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || String(err),
        stack: err?.stack,
        raw: JSON.stringify(err, Object.getOwnPropertyNames(err)),
      },
      { status: 500 }
    );
  }
}
