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
      return NextResponse.json({ message: 'No activity found' }, { status: 200 });
    }

    const toAddress = activity.toAddress.toLowerCase();
    const amount = activity.value;
    const asset = activity.asset;
    const txHash = activity.hash;

    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, wallet_index')
      .filter('evm_deposit_address', 'ilike', toAddress)
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json({ message: 'Address does not belong to platform user' }, { status: 200 });
    }

    const { error: creditError } = await supabaseAdmin.rpc('process_user_deposit', {
      p_user_id: profile.id,
      p_amount: amount,
      p_asset: asset,
      p_tx_hash: txHash,
    });

    if (creditError) throw creditError;

    await supabaseAdmin.from('sweep_queue').insert({
      user_id: profile.id,
      wallet_index: profile.wallet_index ?? 0,
      asset,
      deposit_address: toAddress,
      amount,
      tx_hash: txHash,
      status: asset === 'ETH' ? 'GAS_FUNDED' : 'PENDING_GAS',
    });

    return NextResponse.json({ success: true, message: 'Deposit credited & queued for sweeping' });
  } catch (err: unknown) {
    console.error('Webhook processing failed:', err);
    const anyErr = err as Record<string, unknown> | null;
    const errorMessage = err instanceof Error ? err.message : (anyErr?.message as string) || 'Internal server error';
    const errorDetails = anyErr?.hint || anyErr?.details || (err instanceof Error ? err.stack : String(err));
    const errorCode = anyErr?.code;

    return NextResponse.json(
      {
        error: errorMessage,
        details: errorDetails,
        code: errorCode,
      },
      { status: 500 }
    );
  }
}
