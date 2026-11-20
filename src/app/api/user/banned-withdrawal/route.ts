import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Restricted-account final withdrawals are intentionally fail-closed.
 *
 * The normal withdrawal pipeline denies banned/suspended accounts, and there
 * is no separate verified admin-approved final-payout workflow installed.
 * Do not bypass those shared controls or submit the normal service on behalf
 * of a banned account. This endpoint performs no wallet read, reservation,
 * ledger write, worker dispatch or blockchain call.
 */
export async function POST(_req: NextRequest) {
  try {
    const sessionClient = await createClient();
    const { data: { user }, error: authError } = await sessionClient.auth.getUser();

    if (authError || !user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Session required.' },
        { status: 401 }
      );
    }

    const admin = getSupabaseAdminClient();
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id,is_banned,status,account_status')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json(
        { success: false, error: 'Account restriction status could not be verified. No withdrawal was submitted.' },
        { status: 503 }
      );
    }

    const profileStatus = String(profile.status || '').trim().toLowerCase();
    const accountStatus = String(profile.account_status || '').trim().toLowerCase();
    const isBanned =
      profile.is_banned === true ||
      profileStatus === 'banned' ||
      accountStatus === 'banned';

    if (!isBanned) {
      return NextResponse.json(
        { success: false, error: 'This final-withdrawal endpoint is only for restricted-account recovery.' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        code: 'BANNED_FINAL_WITHDRAWAL_UNAVAILABLE',
        error: 'Final withdrawals for banned accounts are paused until a separately authorized and audited recovery process is available. Your wallet balance has not been changed.',
      },
      { status: 503 }
    );
  } catch (error: unknown) {
    console.error(
      '[BANNED_WITHDRAWAL] Final-withdrawal safety check failed:',
      error instanceof Error ? error.name : 'UnknownError'
    );
    return NextResponse.json(
      { success: false, error: 'Final-withdrawal eligibility could not be verified. No withdrawal was submitted.' },
      { status: 503 }
    );
  }
}
