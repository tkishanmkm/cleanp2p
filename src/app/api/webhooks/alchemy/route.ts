import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Service role client to bypass RLS for automated deposits
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-alchemy-signature');
    const webhookSigningKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;

    // 1. Verify HMAC Signature
    if (webhookSigningKey) {
      const hmac = crypto.createHmac('sha256', webhookSigningKey);
      hmac.update(rawBody);
      const expectedSignature = hmac.digest('hex');

      if (signature !== expectedSignature) {
        return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
      }
    }

    const payload = JSON.parse(rawBody);
    const event = payload.event;

    if (!event || !event.activity) {
      return NextResponse.json({ message: 'No activity found in payload' }, { status: 200 });
    }

    // 2. Process Transfers Atomic & Idempotently
    for (const activity of event.activity) {
      const toAddress = activity.toAddress;
      const asset = activity.asset || 'USDT';
      const network = activity.category || 'ETH_MAINNET';
      const amount = parseFloat(activity.value);
      const txid = activity.hash;
      const outputIndex = activity.logIndex || 0;

      if (!toAddress || !txid || isNaN(amount) || amount <= 0) continue;

      // Call hardened RPC
      const { data, error } = await supabaseAdmin.rpc('process_incoming_deposit', {
        p_to_address: toAddress,
        p_asset: asset,
        p_network: network,
        p_amount: amount,
        p_txid: txid,
        p_output_index: outputIndex,
      });

      if (error) {
        console.error(`Failed to process deposit ${txid}:`, error.message);
      } else if (data?.code === 'ALREADY_PROCESSED') {
        console.log(`Replay ignored for deposit ${txid}`);
      }
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error('Alchemy webhook error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
