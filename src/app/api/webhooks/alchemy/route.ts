import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function verifyAlchemySignature(rawBody: string, signature: string | null): boolean {
  const signingKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;
  if (!signingKey || !signature) return false;

  try {
    const hmac = crypto.createHmac('sha256', signingKey);
    hmac.update(rawBody, 'utf8');
    const digest = hmac.digest('hex');

    const sigBuf = Buffer.from(signature, 'hex');
    const digestBuf = Buffer.from(digest, 'hex');

    if (sigBuf.length !== digestBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, digestBuf);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-alchemy-signature');

    // 1. Constant-Time HMAC Signature Check
    if (!verifyAlchemySignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Unauthorized signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const activity = payload.event?.activity;

    if (!Array.isArray(activity) || activity.length === 0) {
      return NextResponse.json({ message: 'No transfers in payload' }, { status: 200 });
    }

    // 2. Process incoming transfers
    for (const tx of activity) {
      const toAddress = tx.toAddress;
      const asset = (tx.asset || 'ETH').toUpperCase();
      const network = tx.category || 'EVM';
      const txid = tx.hash;
      const logIndex = tx.logIndex ? parseInt(tx.logIndex, 16) : 0;
      const amount = tx.value;

      if (!toAddress || !txid || !amount || Number(amount) <= 0) continue;

      await supabaseAdmin.rpc('process_incoming_deposit', {
        p_to_address: toAddress,
        p_asset: asset,
        p_network: network,
        p_amount: amount,
        p_txid: txid,
        p_output_index: logIndex,
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error('[Alchemy Webhook Error]:', err);
    return NextResponse.json({ error: 'Internal Ingestion Error' }, { status: 500 });
  }
}
