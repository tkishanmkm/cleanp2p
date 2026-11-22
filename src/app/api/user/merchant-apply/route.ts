import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * Merchant activation moves customer funds into a security-deposit liability.
 * This endpoint must remain fail-closed until an atomic database RPC performs
 * the wallet reservation, immutable ledger write, and profile transition in one
 * transaction. Do not reintroduce direct wallet_assets updates here.
 */
export async function POST(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized: Please sign in to apply for Merchant status.' },
        { status: 401 },
      );
    }

    return NextResponse.json(
      {
        error: 'Merchant applications are temporarily unavailable while security-deposit accounting is being secured.',
        code: 'MERCHANT_DEPOSIT_ATOMIC_ACCOUNTING_UNAVAILABLE',
      },
      { status: 503 },
    );
  } catch (error) {
    console.error('POST /api/user/merchant-apply failed closed:', error);
    return NextResponse.json(
      { error: 'Merchant applications are temporarily unavailable.' },
      { status: 503 },
    );
  }
}
