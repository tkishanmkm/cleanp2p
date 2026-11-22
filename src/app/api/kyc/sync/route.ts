import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

const MAX_SYNC_BODY_BYTES = 4 * 1024;

async function readBoundedBody(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SYNC_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function normalizeProviderStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const allowed = new Set([
    'approved', 'passed', 'completed', 'declined', 'rejected', 'failed',
    'in_review', 'pending', 'pending_review', 'submitted',
    'resubmitted', 'resubmit_required', 'expired', 'abandoned',
  ]);
  return allowed.has(normalized) ? normalized : null;
}

export async function GET(req: NextRequest) {
  return handleSync(req);
}

export async function POST(req: NextRequest) {
  return handleSync(req);
}

/**
 * Read-only reconciliation endpoint.
 *
 * Provider polling is not a signed webhook and must never grant or revoke KYC
 * privileges. The signed Didit webhook is the sole state-changing authority and
 * applies profile + verification + event-idempotency changes atomically.
 */
async function handleSync(req: NextRequest) {
  try {
    const admin = getSupabaseAdminClient();
    const supabase = await createServerClient();

    let sessionUser: { id: string; email?: string } | null = null;
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token) {
        const { data, error } = await admin.auth.getUser(token);
        if (!error && data.user) sessionUser = { id: data.user.id, email: data.user.email };
      }
    }

    if (!sessionUser) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) sessionUser = { id: user.id, email: user.email };
    }

    if (!sessionUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let requestedUserId: unknown = new URL(req.url).searchParams.get('userId')
      || new URL(req.url).searchParams.get('id');

    if (req.method === 'POST') {
      const contentLength = Number(req.headers.get('content-length') || 0);
      if (Number.isFinite(contentLength) && contentLength > MAX_SYNC_BODY_BYTES) {
        return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
      }
      const rawBody = await readBoundedBody(req);
      if (rawBody === null) {
        return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
      }
      if (rawBody) {
        let body: unknown;
        try {
          body = JSON.parse(rawBody);
        } catch {
          return NextResponse.json({ error: 'Malformed request JSON.' }, { status: 400 });
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return NextResponse.json({ error: 'A request object is required.' }, { status: 400 });
        }
        const candidate = (body as Record<string, unknown>).userId || (body as Record<string, unknown>).id;
        if (candidate !== undefined) requestedUserId = candidate;
      }
    }

    const targetUserId = requestedUserId === null || requestedUserId === undefined || requestedUserId === ''
      ? sessionUser.id
      : requestedUserId;

    if (typeof targetUserId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
      return NextResponse.json({ error: 'Invalid user ID.' }, { status: 400 });
    }

    if (targetUserId !== sessionUser.id) {
      const adminAuth = await verifyServerAdmin(req);
      if (!adminAuth.authorized) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, kyc_status, is_verified, id_verified, kyc_submitted_at, kyc_last_attempt_at, didit_session_id, kyc_vendor_session_id')
      .eq('id', targetUserId)
      .maybeSingle();

    if (profileError || !profile) {
      console.error('[KYC SYNC] Profile lookup failed', { code: profileError?.code || null });
      return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    }

    const storedStatus = typeof profile.kyc_status === 'string'
      ? profile.kyc_status.trim().toLowerCase()
      : 'not_started';
    const isVerified = ['approved', 'verified'].includes(storedStatus)
      && profile.is_verified === true
      && profile.id_verified === true;

    const sessionId = profile.didit_session_id || profile.kyc_vendor_session_id || null;
    let providerStatus: string | null = null;
    let providerCheck: 'not_configured' | 'unavailable' | 'checked' = 'not_configured';

    const apiKey = process.env.DIDIT_API_KEY?.trim();
    const rawBaseUrl = process.env.DIDIT_API_URL || 'https://verification.didit.me/v3';
    const diditBase = rawBaseUrl.replace(/\/+$/, '');

    if (apiKey && typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 512) {
      providerCheck = 'unavailable';
      try {
        const decisionRes = await fetch(
          `${diditBase}/session/${encodeURIComponent(sessionId)}/decision/`,
          {
            headers: { 'x-api-key': apiKey, Accept: 'application/json' },
            cache: 'no-store',
            signal: AbortSignal.timeout(10_000),
          }
        );

        let providerResult: unknown = null;
        if (decisionRes.ok) {
          providerResult = await decisionRes.json();
        } else if (decisionRes.status === 404 || decisionRes.status === 405) {
          const sessionRes = await fetch(
            `${diditBase}/session/${encodeURIComponent(sessionId)}/`,
            {
              headers: { 'x-api-key': apiKey, Accept: 'application/json' },
              cache: 'no-store',
              signal: AbortSignal.timeout(10_000),
            }
          );
          if (sessionRes.ok) providerResult = await sessionRes.json();
        }

        if (providerResult && typeof providerResult === 'object' && !Array.isArray(providerResult)) {
          const result = providerResult as Record<string, unknown>;
          const decision = result.decision && typeof result.decision === 'object' && !Array.isArray(result.decision)
            ? result.decision as Record<string, unknown>
            : result;
          providerStatus = normalizeProviderStatus(decision.status || result.status || result.verification_status);
          providerCheck = 'checked';
        }
      } catch (providerError) {
        console.warn('[KYC SYNC] Provider status lookup unavailable', {
          error: providerError instanceof Error ? providerError.name : 'UnknownError',
        });
      }
    }

    const submittedAt = profile.kyc_submitted_at || profile.kyc_last_attempt_at;
    const submittedMs = submittedAt ? new Date(submittedAt).getTime() : NaN;
    const hoursSinceSubmission = Number.isFinite(submittedMs)
      ? Math.max(0, (Date.now() - submittedMs) / (1000 * 60 * 60))
      : null;
    const providerTerminal = providerStatus !== null && [
      'approved', 'passed', 'completed', 'declined', 'rejected', 'failed',
      'resubmitted', 'resubmit_required', 'expired', 'abandoned',
    ].includes(providerStatus);

    return NextResponse.json({
      success: true,
      is_verified: isVerified,
      id_verified: isVerified,
      kyc_status: isVerified ? 'approved' : (profile.kyc_status || 'NOT_STARTED'),
      status: isVerified ? 'approved' : (profile.kyc_status || 'NOT_STARTED'),
      provider_status: providerStatus,
      provider_check: providerCheck,
      awaiting_webhook: !isVerified && providerTerminal,
      hoursSinceSubmission: hoursSinceSubmission === null
        ? null
        : Math.round(hoursSinceSubmission * 10) / 10,
    }, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Vary': 'Authorization, Cookie',
      },
    });
  } catch (error) {
    console.error('[KYC SYNC] Read-only status check failed', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Unable to check verification status.' }, { status: 500 });
  }
}
