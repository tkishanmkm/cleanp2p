import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

function verifyAlchemySignature(reqText: string, signature: string | null): boolean {
  if (!signature) return false;
  const signingKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) return false;

  try {
    const hmac = crypto.createHmac('sha256', signingKey);
    hmac.update(reqText, 'utf8');
    const digest = hmac.digest('hex');
    const signatureBuffer = Buffer.from(signature);
    const digestBuffer = Buffer.from(digest);

    if (signatureBuffer.length !== digestBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, digestBuffer);
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-alchemy-signature');

  if (!verifyAlchemySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const activities = payload.event?.activity || [];
  const supabaseAdmin = getSupabaseAdminClient();

  for (const act of activities) {
    const toAddress = act.toAddress?.toLowerCase();
    const txHash = act.hash;
    const value = parseFloat(act.value);
    const asset = act.asset || 'ETH';
    const network = payload.type === 'ADDRESS_ACTIVITY' ? 'ethereum' : 'arbitrum'; // Map accordingly

    if (!toAddress || value <= 0) continue;

    // 1. Resolve user ID assigned to the deposit address
    const { data: addressRecord } = await supabaseAdmin
      .from('user_deposit_addresses')
      .select('user_id')
      .eq('address', toAddress)
      .single();

    if (!addressRecord) continue;

    const userId = addressRecord.user_id;

    // 2. Insert transaction log with unique constraint handling
    const { error: txError } = await supabaseAdmin
      .from('wallet_transactions')
      .insert({
        user_id: userId,
        tx_hash: txHash,
        type: 'deposit',
        network: network,
        asset_symbol: asset,
        amount: value,
        from_address: act.fromAddress,
        to_address: toAddress,
        status: 'confirmed',
        block_number: parseInt(act.blockNum, 16)
      });

    // If tx_hash already exists, skip balance updates (Idempotency check)
    if (txError && txError.code === '23505') {
      console.log(`Transaction ${txHash} already processed.`);
      continue;
    }

    // 3. Atomically update wallet balance
    await supabaseAdmin.rpc('credit_user_balance', {
      target_user_id: userId,
      target_asset: asset,
      target_network: network,
      credit_amount: value
    });
  }

  return NextResponse.json({ status: 'success' }, { status: 200 });
}
