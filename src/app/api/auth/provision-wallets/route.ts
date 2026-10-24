import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { timingSafeEqualString } from '@/lib/security/worker-auth';
import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';

export const dynamic = 'force-dynamic';

function getAdminClient() {
  return getSupabaseAdminClient();
}

function isTrustedProvisioningRequest(req: NextRequest): boolean {
  const configuredSecret = process.env.WALLET_PROVISIONING_SECRET?.trim();
  if (!configuredSecret || configuredSecret === 'placeholder-secret' || configuredSecret === 'placeholder-key') {
    return false;
  }
  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const suppliedSecret = match?.[1]?.trim() || '';
  return Boolean(suppliedSecret) && timingSafeEqualString(suppliedSecret, configuredSecret);
}

async function resolveAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const adminClient = getAdminClient();

  // 1. Check Bearer Authorization Header
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const { data, error } = await adminClient.auth.getUser(token);
      if (!error && data?.user?.id) {
        return data.user.id;
      }
    } catch {
      // Fall through to cookie check
    }
  }

  // 2. Check SSR Cookies
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://eaiwgfxoiwxepinvcykg.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (supabaseUrl && supabaseAnonKey) {
    try {
      const cookieStore = await cookies();
      const ssrClient = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
        },
      });
      const {
        data: { user },
      } = await ssrClient.auth.getUser();
      if (user?.id) {
        return user.id;
      }
    } catch {
      // Failed to resolve cookie session
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    // Accept either a verified user session for that same user or a dedicated,
    // constant-time-checked internal provisioning secret for the database trigger.
    const trustedInternalRequest = isTrustedProvisioningRequest(req);
    const authenticatedUserId = trustedInternalRequest ? null : await resolveAuthenticatedUserId(req);
    if (!trustedInternalRequest && !authenticatedUserId) {
      return NextResponse.json(
        { error: 'Unauthorized. Authentication is required to provision wallets.' },
        { status: 401 }
      );
    }

    let bodyUserId: string | null = null;
    try {
      const body = await req.json();
      bodyUserId = typeof body?.userId === 'string' ? body.userId.trim() : null;
    } catch {
      // User-session requests may omit a body; internal requests may not.
    }

    if (trustedInternalRequest) {
      if (!bodyUserId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bodyUserId)) {
        return NextResponse.json({ error: 'A valid userId is required for internal provisioning.' }, { status: 400 });
      }
    } else if (bodyUserId && bodyUserId !== authenticatedUserId) {
      return NextResponse.json(
        { error: 'Forbidden. Cannot provision wallets for another user.' },
        { status: 403 }
      );
    }

    const targetUserId = trustedInternalRequest ? bodyUserId as string : authenticatedUserId as string;
    const adminClient = getAdminClient();

    // 3. Inspect existing profile to verify wallet_index presence (Task 4)
    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('id, wallet_index, evm_deposit_address, tron_deposit_address, btc_deposit_address, ltc_deposit_address')
      .eq('id', targetUserId)
      .maybeSingle();

    if (profileErr || !profile) {
      return NextResponse.json(
        { error: 'User profile not found.' },
        { status: 404 }
      );
    }

    // Strict validation: Fail closed if wallet_index is missing/null/invalid. NO FALLBACK TO 0.
    if (profile.wallet_index === null || profile.wallet_index === undefined || typeof profile.wallet_index !== 'number' || profile.wallet_index <= 0) {
      return NextResponse.json(
        { 
          error: 'Fail-closed: User profile has no valid allocated wallet_index. Address derivation cannot proceed without an assigned sequence index.' 
        },
        { status: 422 }
      );
    }

    // 4. Canonical Synchronized Provisioning via Atomic RPC
    const result = await getOrDeriveUserDepositAddresses(targetUserId);

    return NextResponse.json({
      success: true,
      walletIndex: result.walletIndex,
      addresses: {
        evm: result.addresses.ETH,
        tron: result.addresses.USDT_TRC20,
        btc: result.addresses.BTC,
        ltc: result.addresses.LTC,
        BTC: result.addresses.BTC,
        ETH: result.addresses.ETH,
        LTC: result.addresses.LTC,
        USDT_ERC20: result.addresses.USDT_ERC20,
        USDT_BEP20: result.addresses.USDT_BEP20,
        USDT_TRC20: result.addresses.USDT_TRC20,
      },
      userId: targetUserId,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/auth/provision-wallets] Error:', errorMsg);
    return NextResponse.json(
      { error: errorMsg || 'Failed to provision wallets' },
      { status: 500 }
    );
  }
}

