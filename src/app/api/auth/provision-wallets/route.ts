import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { isWalletProvisioningServiceBearer } from '@/lib/wallet/provisioning-auth';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 2048;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getAuthClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!supabaseUrl || !supabaseUrl.startsWith('https://') || supabaseUrl.includes('placeholder')) {
    throw new Error('A valid Supabase HTTPS URL is required');
  }

  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!anonKey) {
    throw new Error('Supabase public authentication key is not configured');
  }

  return createSupabaseClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function resolveAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const authClient = getAuthClient();

  // 1. Check a Supabase user access token. User sessions are limited to their
  // own wallet and are never treated as trusted service-to-service callers.
  const authHeader = req.headers.get('authorization');
  if (authHeader && /^Bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const { data, error } = await authClient.auth.getUser(token);
      if (!error && data?.user?.id) {
        return data.user.id;
      }
    } catch {
      // Fall through to cookie authentication.
    }
  }

  // 2. Check the SSR cookie session.
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    '';
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    '';

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
      // No valid cookie session.
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    // The database trigger sends the Vault secret as Authorization: Bearer.
    // It is checked independently from Supabase user JWT authentication.
    // Configure the same high-entropy value as Supabase Vault
    // wallet_provisioning_bearer and the server-only app env
    // WALLET_PROVISIONING_BEARER.
    const isServiceRequest = isWalletProvisioningServiceBearer(
      req.headers.get('authorization'),
      process.env.WALLET_PROVISIONING_BEARER
    );

    const authenticatedUserId = isServiceRequest
      ? null
      : await resolveAuthenticatedUserId(req);

    if (!isServiceRequest && !authenticatedUserId) {
      return NextResponse.json(
        { error: 'Unauthorized. A valid user session or wallet provisioning service credential is required.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: 'Wallet provisioning request is too large.' },
        { status: 413, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: 'Wallet provisioning request is too large.' },
        { status: 413, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    let body: Record<string, unknown> = {};
    if (rawBody.trim()) {
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        return NextResponse.json(
          { error: 'A valid JSON object is required.' },
          { status: 400, headers: { 'Cache-Control': 'no-store' } }
        );
      }

      if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
        return NextResponse.json(
          { error: 'A valid JSON object is required.' },
          { status: 400, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      body = parsedBody as Record<string, unknown>;
    }

    const rawBodyUserId = body.userId;
    if (rawBodyUserId !== undefined && rawBodyUserId !== null && typeof rawBodyUserId !== 'string') {
      return NextResponse.json(
        { error: 'userId must be a UUID string.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const bodyUserId = typeof rawBodyUserId === 'string' ? rawBodyUserId.trim() : '';

    let targetUserId: string;
    if (isServiceRequest) {
      // The service credential may provision only an explicit, well-formed
      // user ID supplied by the trusted database trigger.
      if (!UUID_PATTERN.test(bodyUserId)) {
        return NextResponse.json(
          { error: 'A valid userId is required for service wallet provisioning.' },
          { status: 400, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      targetUserId = bodyUserId;
    } else {
      // A normal signed-in user can only provision the wallet bound to their
      // verified Supabase identity.
      if (bodyUserId && bodyUserId !== authenticatedUserId) {
        return NextResponse.json(
          { error: 'Forbidden. Cannot provision wallets for another user.' },
          { status: 403, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      targetUserId = authenticatedUserId!;
    }

    const adminClient = getSupabaseAdminClient();

    // Verify the target profile and its allocated derivation index before
    // invoking the atomic production provisioning RPC.
    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('id, wallet_index')
      .eq('id', targetUserId)
      .maybeSingle();

    if (profileErr || !profile) {
      console.error('[POST /api/auth/provision-wallets] Profile lookup failed.', {
        code: profileErr?.code || null,
      });
      return NextResponse.json(
        { error: 'User profile could not be verified for wallet provisioning.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (
      !Number.isSafeInteger(profile.wallet_index) ||
      profile.wallet_index <= 0 ||
      profile.wallet_index > 0x7fffffff
    ) {
      return NextResponse.json(
        { error: 'The user profile has no valid allocated wallet index. Wallet provisioning is blocked.' },
        { status: 422, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const result = await getOrDeriveUserDepositAddresses(targetUserId);

    return NextResponse.json(
      {
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
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err: unknown) {
    // Never write authorization headers, secret values or derived addresses to logs.
    console.error('[POST /api/auth/provision-wallets] Provisioning failed.', {
      errorName: err instanceof Error ? err.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'Wallet provisioning is temporarily unavailable. Please retry.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
