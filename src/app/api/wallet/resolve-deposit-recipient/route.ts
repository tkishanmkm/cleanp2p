import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import {
  DepositAddressOwnershipConflictError,
  normalizeDepositAddressForLookup,
} from '@/lib/wallet/deposit-address-owner';
import { resolveDepositAddressOwner } from '@/lib/wallet/deposit-address-owner.server';
import { isTransferAccountBlocked } from '@/lib/transfer-account-status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const authClient = await createClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 2048) {
      return NextResponse.json(
        { success: false, error: 'Request body is too large.' },
        { status: 413, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: 'A valid JSON object is required.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const address = (body as Record<string, unknown>).address;
    if (!normalizeDepositAddressForLookup(address)) {
      return NextResponse.json(
        { success: false, error: 'A valid deposit address is required.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const adminClient = getSupabaseAdminClient();
    let recipientId: string | null;

    try {
      recipientId = await resolveDepositAddressOwner(adminClient, address);
    } catch (error) {
      if (error instanceof DepositAddressOwnershipConflictError) {
        return NextResponse.json(
          {
            success: false,
            error: 'This address has conflicting ownership records. Contact support before sending funds.',
            code: error.code,
          },
          { status: 409, headers: { 'Cache-Control': 'no-store' } }
        );
      }

      console.error('[wallet/resolve-deposit-recipient] Address ownership lookup failed.');
      return NextResponse.json(
        { success: false, error: 'Address ownership could not be verified. Please retry.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (!recipientId) {
      return NextResponse.json(
        { success: false, error: 'No Wayones account is registered for this address.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const { data: recipient, error: recipientError } = await adminClient
      .from('profiles')
      .select('id, username, is_banned, is_restricted, is_suspended, is_minor_restricted, is_emergency_frozen, account_status, status')
      .eq('id', recipientId)
      .maybeSingle();

    if (recipientError) {
      console.error('[wallet/resolve-deposit-recipient] Public profile lookup failed.', {
        code: recipientError.code || null,
      });
      return NextResponse.json(
        { success: false, error: 'Recipient profile could not be verified. Please retry.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (!recipient) {
      return NextResponse.json(
        { success: false, error: 'No active public profile is registered for this address.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json(
      {
        success: true,
        recipient: {
          id: recipient.id,
          username: recipient.username,
          is_trading_eligible: !isTransferAccountBlocked(recipient),
        },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[wallet/resolve-deposit-recipient] Request failed.');
    return NextResponse.json(
      { success: false, error: 'Recipient lookup is temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
