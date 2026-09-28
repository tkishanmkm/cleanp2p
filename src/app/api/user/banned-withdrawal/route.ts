import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { executeCanonicalWithdrawal } from '@/lib/services/withdrawalService';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const supabaseAdmin = getSupabaseAdminClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: Session required.' }, { status: 401 });
    }

    const userId = user.id;

    // Verify user profile is marked as banned
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, is_banned, status, account_status')
      .eq('id', userId)
      .maybeSingle();

    if (!profile || (!profile.is_banned && profile.status !== 'banned' && profile.account_status !== 'banned')) {
      return NextResponse.json({ error: 'Only banned accounts can use final withdrawal.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { currency, address, network, totpCode } = body;

    if (!currency || !address || typeof address !== 'string' || address.trim().length < 8) {
      return NextResponse.json({ error: 'Valid cryptocurrency and destination wallet address are required.' }, { status: 400 });
    }

    const assetSymbol = String(currency).toUpperCase().trim();

    // Fetch authoritative spendable balance from public.wallet_assets
    const { data: assetRow } = await supabaseAdmin
      .from('wallet_assets')
      .select('balance')
      .eq('user_id', userId)
      .eq('asset_symbol', assetSymbol)
      .maybeSingle();

    const currentBalance = Number(assetRow?.balance || 0);
    if (currentBalance <= 0) {
      return NextResponse.json({ error: `No spendable balance for ${assetSymbol} to withdraw.` }, { status: 400 });
    }

    // Delegate through canonical withdrawal pipeline
    const authHeader = req.headers.get('authorization');
    const result = await executeCanonicalWithdrawal({
      asset: assetSymbol,
      amount: currentBalance,
      network: network || (assetSymbol === 'USDT' ? 'TRC20' : assetSymbol),
      destinationAddress: address.trim(),
      totpCode,
      authHeader,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error || result.message }, { status: result.statusCode || 400 });
    }

    return NextResponse.json({
      success: true,
      status: 'Queued',
      amount: currentBalance,
      currency: assetSymbol,
      withdrawalId: result.withdrawalId,
      message: `Final withdrawal of full ${assetSymbol} balance queued to ${address.trim()}.`,
    });
  } catch (err: any) {
    console.error('Final withdrawal fatal error:', err);
    return NextResponse.json({ error: err.message || 'Withdrawal processing failed.' }, { status: 500 });
  }
}
