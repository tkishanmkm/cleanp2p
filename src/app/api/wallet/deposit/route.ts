import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const authHeader = req.headers.get('authorization');
    const webhookSecret = process.env.BLOCKCHAIN_WEBHOOK_SECRET;

    if (webhookSecret && authHeader !== `Bearer ${webhookSecret}`) {
      return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
    }

    const body = await req.json();
    const { userId, assetCode, networkCode, amount, txHash } = body;

    if (!userId || !assetCode || !amount || !txHash) {
      return NextResponse.json({ error: 'Missing deposit payload fields' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('credit_onchain_deposit', {
      p_user_id: userId,
      p_asset_code: assetCode,
      p_network_code: networkCode || 'MAINNET',
      p_amount: Number(amount),
      p_tx_hash: txHash
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
