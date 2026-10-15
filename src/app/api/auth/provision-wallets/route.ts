import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';

export const dynamic = 'force-dynamic';

function getAdminClient() {
  // This route reads privileged profile fields; never downgrade to an anon key
  // or silently target a hard-coded production project.
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Wallet provisioning admin client is not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'
    );
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
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
    // Parse the body once. Database-triggered provisioning uses a separate,
    // server-only shared secret; normal callers must authenticate as themselves.
    let bodyUserId: string | null = null;
    try {
      const body = await req.json();
      bodyUserId = typeof body?.userId === 'string' ? body.userId : null;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (bodyUserId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bodyUserId)) {
      return NextResponse.json({ error: 'Invalid user ID.' }, { status: 400 });
    }

    const authHeader = req.headers.get('authorization') || '';
    const bearerToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
    const internalSecret = process.env.WALLET_PROVISIONING_BEARER || '';
    let isInternalProvisioning = false;

    if (internalSecret && bearerToken) {
      const supplied = Buffer.from(bearerToken, 'utf8');
      const expected = Buffer.from(internalSecret, 'utf8');
      if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) {
        isInternalProvisioning = true;
      }
    }

    let targetUserId: string;
    if (isInternalProvisioning) {
      if (!bodyUserId) {
        return NextResponse.json({ error: 'Internal provisioning requires a user ID.' }, { status: 400 });
      }
      targetUserId = bodyUserId;
    } else {
      const authenticatedUserId = await resolveAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        return NextResponse.json(
          { error: 'Unauthorized. Authentication is required to provision wallets.' },
          { status: 401 }
        );
      }

      if (bodyUserId && bodyUserId !== authenticatedUserId) {
        return NextResponse.json(
          { error: 'Forbidden. Cannot provision wallets for another user.' },
          { status: 403 }
        );
      }
      targetUserId = authenticatedUserId;
    }
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

