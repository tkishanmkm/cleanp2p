import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The database signup trigger sends the Vault-stored wallet_provisioning_bearer
 * as an Authorization bearer token. It is not a Supabase user access token.
 * Keep this secret server-only and compare it in constant time.
 */
function isInternalProvisionAuthorized(req: NextRequest): boolean {
  const configuredSecret = (
    process.env.WALLET_PROVISIONING_SECRET ||
    process.env.PROVISION_SERVICE_KEY ||
    ''
  ).trim();
  const authorization = req.headers.get('authorization') || '';
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);
  const providedSecret = (bearerMatch?.[1] || req.headers.get('x-provision-secret') || '').trim();

  if (!configuredSecret || !providedSecret) return false;

  const expected = Buffer.from(configuredSecret, 'utf8');
  const provided = Buffer.from(providedSecret, 'utf8');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

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

  // 1. Check Bearer Authorization Header
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const { data, error } = await authClient.auth.getUser(token);
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
    '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

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
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 2048) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
    }

    const bodyReader = req.body?.getReader();
    if (!bodyReader) {
      return NextResponse.json({ error: 'A valid JSON object is required.' }, { status: 400 });
    }

    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    try {
      while (true) {
        const { done, value } = await bodyReader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > 2048) {
          await bodyReader.cancel().catch(() => undefined);
          return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
        }
        chunks.push(value);
      }
    } catch {
      return NextResponse.json({ error: 'Could not read request body.' }, { status: 400 });
    }

    const bodyBytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bodyBytes));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('A JSON object is required.');
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'A valid JSON object is required.' }, { status: 400 });
    }

    const rawBodyUserId = body.userId;
    const bodyUserId = typeof rawBodyUserId === 'string' ? rawBodyUserId.trim() : null;
    if (rawBodyUserId != null && (!bodyUserId || !UUID_PATTERN.test(bodyUserId))) {
      return NextResponse.json(
        { error: 'userId must be a valid UUID when supplied.' },
        { status: 400 }
      );
    }

    const internalAuthorized = isInternalProvisionAuthorized(req);

    // Internal Vault bearer requests are service-authorized and may provision
    // the signup-trigger's target user. Ordinary sessions remain self-only.
    const authenticatedUserId = internalAuthorized
      ? null
      : await resolveAuthenticatedUserId(req);

    if (!internalAuthorized && !authenticatedUserId) {
      return NextResponse.json(
        { error: 'Unauthorized. A valid user session or internal provisioning secret is required.' },
        { status: 401 }
      );
    }

    if (internalAuthorized && (!bodyUserId || !UUID_PATTERN.test(bodyUserId))) {
      return NextResponse.json(
        { error: 'A valid userId is required for internal wallet provisioning.' },
        { status: 400 }
      );
    }

    if (!internalAuthorized && bodyUserId && bodyUserId !== authenticatedUserId) {
      return NextResponse.json(
        { error: 'Forbidden. Cannot provision wallets for another user.' },
        { status: 403 }
      );
    }

    const targetUserId = internalAuthorized ? bodyUserId! : authenticatedUserId!;
    const adminClient = getSupabaseAdminClient();

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
    if (
      typeof profile.wallet_index !== 'number' ||
      !Number.isSafeInteger(profile.wallet_index) ||
      profile.wallet_index <= 0 ||
      profile.wallet_index > 0x7fffffff
    ) {
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

