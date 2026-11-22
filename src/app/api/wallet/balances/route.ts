import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const SUPPORTED_ASSETS = new Set(['ETH', 'USDT', 'BTC', 'LTC']);

export async function GET(req: NextRequest) {
  try {
    const sessionClient = await createClient();
    const { data: { user }, error: authError } = await sessionClient.auth.getUser();
    if (authError || !user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const address = new URL(req.url).searchParams.get('address')?.trim() || '';
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json({ success: false, error: 'Invalid wallet address' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const normalizedAddress = address.toLowerCase();

    // Resolve the address owner using the server client. The address is not
    // itself a balance source: it is only used to bind the request to the
    // authenticated user's account.
    const [walletOwners, depositOwners, legacyDepositOwners] = await Promise.all([
      admin.from('wallets').select('user_id').ilike('address', normalizedAddress).limit(50),
      admin.from('deposit_addresses').select('user_id').ilike('address', normalizedAddress).limit(50),
      admin.from('user_deposit_addresses').select('user_id').ilike('address', normalizedAddress).limit(50),
    ]);

    if (walletOwners.error || depositOwners.error || legacyDepositOwners.error ||
        !Array.isArray(walletOwners.data) || !Array.isArray(depositOwners.data) ||
        !Array.isArray(legacyDepositOwners.data)) {
      console.error('[WALLET_BALANCES] Address ownership lookup failed:', walletOwners.error?.code || depositOwners.error?.code || legacyDepositOwners.error?.code || 'unknown');
      return NextResponse.json({ success: false, error: 'Wallet ownership could not be verified.' }, { status: 503 });
    }

    const owners = [
      ...walletOwners.data,
      ...depositOwners.data,
      ...legacyDepositOwners.data,
    ]
      .map((row) => row.user_id)
      .filter((value): value is string => typeof value === 'string');
    const uniqueOwners = Array.from(new Set(owners));

    if (uniqueOwners.length === 0) {
      return NextResponse.json({ success: false, error: 'Wallet address not found' }, { status: 404 });
    }
    if (uniqueOwners.length !== 1) {
      console.error('[WALLET_BALANCES] Conflicting owners found for wallet address.');
      return NextResponse.json({ success: false, error: 'Wallet ownership is ambiguous. Contact support.' }, { status: 409 });
    }
    if (uniqueOwners[0] !== user.id) {
      return NextResponse.json({ success: false, error: 'Forbidden: cannot read another user wallet' }, { status: 403 });
    }

    // wallet_assets is the canonical balance ledger. Deposits, raw chain
    // balances, legacy profile fields and old wallet rows must never be added
    // on top of it or used to inflate an available balance.
    const { data: assetRows, error: assetError } = await admin
      .from('wallet_assets')
      .select('asset_symbol,balance')
      .eq('user_id', user.id);

    if (assetError || !Array.isArray(assetRows)) {
      console.error('[WALLET_BALANCES] Canonical wallet balance read failed:', assetError?.code || 'invalid_response');
      return NextResponse.json({ success: false, error: 'Canonical wallet balances are temporarily unavailable.' }, { status: 503 });
    }

    const totals: Record<string, number> = { ETH: 0, USDT: 0, BTC: 0, LTC: 0 };
    for (const row of assetRows) {
      const asset = String(row.asset_symbol || '').trim().toUpperCase();
      if (!SUPPORTED_ASSETS.has(asset)) continue;
      const balance = Number(row.balance ?? 0);
      if (!Number.isFinite(balance) || balance < 0) {
        console.error('[WALLET_BALANCES] Invalid canonical balance row encountered.');
        return NextResponse.json({ success: false, error: 'Wallet balance reconciliation is required.' }, { status: 503 });
      }
      totals[asset] = balance;
    }

    return NextResponse.json(
      {
        success: true,
        balances: [
          { network: 'Ethereum Mainnet', symbol: 'ETH', balance: totals.ETH.toFixed(8) },
          { network: 'USDT (All Chains)', symbol: 'USDT', balance: totals.USDT.toFixed(8) },
          { network: 'Bitcoin', symbol: 'BTC', balance: totals.BTC.toFixed(8) },
          { network: 'Litecoin', symbol: 'LTC', balance: totals.LTC.toFixed(8) },
        ],
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: unknown) {
    console.error('[WALLET_BALANCES] Unexpected failure:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { success: false, error: 'Canonical wallet balances are temporarily unavailable.' },
      { status: 500 }
    );
  }
}
