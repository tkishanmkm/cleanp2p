import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { saveKycAddressToB2 } from '@/lib/b2';
import { isTier2User } from '@/lib/kyc';

export const dynamic = 'force-dynamic';

const MAX_KYC_INITIATION_BODY_BYTES = 16 * 1024;

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
      if (totalBytes > MAX_KYC_INITIATION_BODY_BYTES) {
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
  return new TextDecoder('utf-8').decode(bytes);
}

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate caller session
    const supabaseUser = await createClient();
    let { data: { user } } = await supabaseUser.auth.getUser();

    const authHeader = req.headers.get("authorization");
    if (!user && authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7).trim();
      if (token) {
        const adminClient = getSupabaseAdminClient();
        const { data: tokenData } = await adminClient.auth.getUser(token);
        if (tokenData?.user) user = tokenData.user;
      }
    }

    if (!user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Authentication session required to initiate KYC." },
        { status: 401 }
      );
    }

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_KYC_INITIATION_BODY_BYTES) {
      return NextResponse.json({ error: 'KYC request body is too large.' }, { status: 413 });
    }

    const rawBody = await readBoundedBody(req);
    if (rawBody === null) {
      return NextResponse.json({ error: 'KYC request body is too large.' }, { status: 413 });
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ error: 'A valid KYC request object is required.' }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Malformed KYC request JSON.' }, { status: 400 });
    }

    const stringFields: Array<[string, number]> = [
      ['country', 2], ['address', 600], ['street', 300], ['city', 160],
      ['postalCode', 32], ['docType', 64], ['docNumber', 128],
    ];
    for (const [field, maxLength] of stringFields) {
      const value = body[field];
      if (value !== undefined && (typeof value !== 'string' || value.length > maxLength)) {
        return NextResponse.json({ error: `Invalid KYC field: ${field}.` }, { status: 400 });
      }
    }

    const requestedUserId = body.userId;
    if (requestedUserId !== undefined && (typeof requestedUserId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedUserId))) {
      return NextResponse.json({ error: 'Invalid target user ID.' }, { status: 400 });
    }

    const country = body.country as string | undefined;
    const address = body.address as string | undefined;
    const street = body.street as string | undefined;
    const city = body.city as string | undefined;
    const postalCode = body.postalCode as string | undefined;
    const docType = body.docType as string | undefined;
    const docNumber = body.docNumber as string | undefined;
    const allowedDocumentTypes = new Set(['PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE', 'RESIDENCE_PERMIT', 'GOVERNMENT_ID']);
    if (country !== undefined && !/^[A-Za-z]{2}$/.test(country.trim())) {
      return NextResponse.json({ error: 'Country must be a valid two-letter ISO country code.' }, { status: 400 });
    }
    if (docType !== undefined && !allowedDocumentTypes.has(docType)) {
      return NextResponse.json({ error: 'Unsupported identity document type.' }, { status: 400 });
    }

    let targetUserId = user.id;
    if (requestedUserId && requestedUserId !== user.id) {
      const adminAuth = await verifyServerAdmin(req);
      if (!adminAuth.authorized) {
        return NextResponse.json(
          { error: "forbidden", message: "Cannot initiate KYC verification for another user." },
          { status: 403 }
        );
      }
      targetUserId = requestedUserId;
    }

    const userId = targetUserId;
    const supabase = getSupabaseAdminClient();

    // 1. Fetch user status
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('kyc_status, is_banned, kyc_retry_count, kyc_attempts, kyc_last_attempt_at, kyc_submitted_at, is_verified, id_verified')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Rule: Immediately reject if already banned
    if (profile.is_banned || profile.kyc_status === 'banned') {
      return NextResponse.json({ error: 'Account is banned from performing KYC' }, { status: 403 });
    }

    const isApprovedTier2 = isTier2User(profile);
    if (isApprovedTier2) {
      return NextResponse.json({
        success: true,
        message: 'Account is already verified with Tier 2 privileges.',
        status: 'approved',
      });
    }

    // Validate all provider and callback destinations before storing compliance data
    // or making an outbound request. A configurable URL must never become an SSRF
    // primitive or cause identity documents to be submitted to an untrusted host.
    const apiKey = process.env.DIDIT_API_KEY?.trim();
    const workflowId = process.env.DIDIT_WORKFLOW_ID?.trim();
    if (!apiKey || !workflowId) {
      const missing = [
        !apiKey ? 'DIDIT_API_KEY' : null,
        !workflowId ? 'DIDIT_WORKFLOW_ID' : null,
      ].filter(Boolean);
      return NextResponse.json({
        error: 'Verification service is not configured',
        missing_configuration: missing,
      }, { status: 503 });
    }

    const rawDiditBaseUrl = process.env.DIDIT_API_URL?.trim() || 'https://verification.didit.me/v3';
    let parsedDiditBaseUrl: URL;
    try {
      parsedDiditBaseUrl = new URL(rawDiditBaseUrl);
    } catch {
      return NextResponse.json({ error: 'Verification service configuration is invalid.' }, { status: 503 });
    }
    const diditApiHost = parsedDiditBaseUrl.hostname.toLowerCase();
    const trustedDiditApiHost = diditApiHost === 'verification.didit.me';
    if (
      parsedDiditBaseUrl.protocol !== 'https:' ||
      !trustedDiditApiHost ||
      parsedDiditBaseUrl.username ||
      parsedDiditBaseUrl.password ||
      (parsedDiditBaseUrl.port !== '' && parsedDiditBaseUrl.port !== '443') ||
      parsedDiditBaseUrl.search ||
      parsedDiditBaseUrl.hash
    ) {
      console.error('[KYC INITIATE] DIDIT_API_URL is not an approved HTTPS provider endpoint.');
      return NextResponse.json({ error: 'Verification service configuration is invalid.' }, { status: 503 });
    }
    const diditBase = parsedDiditBaseUrl.toString().replace(/\/+$/, '');
    const targetUrl = new URL('session/', diditBase.endsWith('/') ? diditBase : diditBase + '/').toString();

    const rawSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://paxones.com').trim();
    let parsedSiteUrl: URL;
    try {
      parsedSiteUrl = new URL(rawSiteUrl);
    } catch {
      return NextResponse.json({ error: 'Application callback URL configuration is invalid.' }, { status: 503 });
    }
    const localDevelopmentHost = process.env.NODE_ENV === 'development'
      && ['localhost', '127.0.0.1', '[::1]'].includes(parsedSiteUrl.hostname.toLowerCase());
    if (
      (parsedSiteUrl.protocol !== 'https:' && !(localDevelopmentHost && parsedSiteUrl.protocol === 'http:')) ||
      parsedSiteUrl.username ||
      parsedSiteUrl.password ||
      parsedSiteUrl.search ||
      parsedSiteUrl.hash
    ) {
      console.error('[KYC INITIATE] Application callback URL must use a trusted HTTPS origin.');
      return NextResponse.json({ error: 'Application callback URL configuration is invalid.' }, { status: 503 });
    }
    const callbackUrl = new URL('/dashboard/kyc/callback', parsedSiteUrl.origin).toString();

    // Sanitize residual verification flags only when the owner row was actually
    // updated. Continuing after a failed reset could let stale privilege flags
    // survive a new KYC attempt.
    if (profile.is_verified || profile.id_verified) {
      const { data: resetRows, error: resetError } = await supabase
        .from('profiles')
        .update({ is_verified: false, id_verified: false, updated_at: new Date().toISOString() })
        .eq('id', userId)
        .select('id');
      if (resetError || !Array.isArray(resetRows) || resetRows.length !== 1) {
        console.error('[KYC INITIATE] Could not clear stale verification flags', {
          code: resetError?.code || null,
          rows: Array.isArray(resetRows) ? resetRows.length : null,
        });
        return NextResponse.json(
          { error: 'Could not safely reset verification state. Please retry or contact support.' },
          { status: 503 }
        );
      }
      profile.is_verified = false;
      profile.id_verified = false;
    }

    const lastAttemptTime = profile.kyc_last_attempt_at || profile.kyc_submitted_at;
    const hoursSinceLastAttempt = lastAttemptTime ? (Date.now() - new Date(lastAttemptTime).getTime()) / (1000 * 60 * 60) : 999;

    let retryCount = Number(profile.kyc_retry_count || profile.kyc_attempts || 0);

    // If 24 hours have passed since previous attempt, reset the attempt count
    if (hoursSinceLastAttempt >= 24) {
      retryCount = 0;
    }

    // Rule: Reject if 3 retries exceeded or permanently rejected
    if (profile.kyc_status === 'permanently_rejected' || retryCount >= 3) {
      return NextResponse.json({
        error: 'KYC_LIMIT_REACHED',
        message: 'Maximum KYC retry attempts (3/3) exceeded in 24 hours. Your verification is locked. Please contact support.',
      }, { status: 403 });
    }

    // Rule: If under review and within 24 hours, inform user
    if ((profile.kyc_status === 'in_review' || profile.kyc_status === 'pending') && hoursSinceLastAttempt < 24) {
      return NextResponse.json({
        error: 'KYC_UNDER_REVIEW',
        message: 'Your verification is currently under review (active for up to 24 hours). Please wait or sync status.',
      }, { status: 400 });
    }

    // 2. Compress and save KYC address details directly into Backblaze B2 (Private compliance document)
    const b2Res = await saveKycAddressToB2(userId, {
      userId,
      country,
      address,
      street,
      city,
      postalCode,
      docType,
      docNumber,
      submittedAt: new Date().toISOString(),
    });
    if (!b2Res.success || !b2Res.key) {
      // KYC address and document metadata are compliance records. Do not continue
      // with provider verification while the private encrypted copy cannot be saved.
      return NextResponse.json({ error: 'Secure document storage is temporarily unavailable. Please try again later.' }, { status: 503 });
    }
    const b2Key = b2Res.key;

    // 3. Persist the validated address fields and require exactly one profile row.
    // Do not contact the KYC provider if local compliance data could not be saved.
    const profilePatch: Record<string, unknown> = {
      ...(country ? { country: country.toUpperCase() } : {}),
      ...(address ? { address } : {}),
      ...(street ? { address_street: street } : {}),
      ...(city ? { address_city: city } : {}),
      ...(postalCode ? { address_postal_code: postalCode } : {}),
      ...(b2Key ? { kyc_documents_b2_key: b2Key } : {}),
      updated_at: new Date().toISOString(),
    };
    const { data: updatedProfiles, error: profileUpdateError } = await supabase
      .from('profiles')
      .update(profilePatch)
      .eq('id', userId)
      .select('id');

    if (profileUpdateError || !Array.isArray(updatedProfiles) || updatedProfiles.length !== 1) {
      console.error('[KYC INITIATE] Profile compliance-data write failed', {
        code: profileUpdateError?.code || null,
        rows: Array.isArray(updatedProfiles) ? updatedProfiles.length : null,
      });
      return NextResponse.json({ error: 'Could not securely save verification details. Please retry.' }, { status: 503 });
    }

    // 4. Request session from the pre-validated verification provider endpoint.
    let res: Response;
    try {
      res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_id: workflowId,
          vendor_data: userId,
          callback: callbackUrl,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (fetchErr: any) {
      console.error('[KYC INITIATE] Verification provider request failed:', fetchErr?.name || 'unknown error');
      return NextResponse.json({ error: 'Verification service is temporarily unavailable. Please try again later.' }, { status: 502 });
    }

    if (!res.ok) {
      // Do not return the provider response body to the browser; it may contain
      // internal diagnostics or user/provider metadata.
      console.error('[KYC INITIATE] Verification provider rejected session request:', res.status);
      return NextResponse.json({ error: 'Failed to create verification session. Please try again later.' }, { status: 502 });
    }

    let session: any;
    try {
      session = await res.json();
    } catch {
      return NextResponse.json({ error: 'Verification service returned an invalid response' }, { status: 502 });
    }
    const sessionId = session?.session_id || session?.id || session?.vendor_session_id;
    const sessionUrl = typeof session?.url === 'string' ? session.url : '';
    let parsedSessionUrl: URL;
    try {
      parsedSessionUrl = new URL(sessionUrl);
    } catch {
      return NextResponse.json({ error: 'Verification service returned an invalid session URL' }, { status: 502 });
    }
    const sessionHost = parsedSessionUrl.hostname.toLowerCase();
    const trustedDiditHost = sessionHost === 'didit.me' || sessionHost.endsWith('.didit.me');
    if (
      typeof sessionId !== 'string' ||
      !sessionId.trim() ||
      parsedSessionUrl.protocol !== 'https:' ||
      !trustedDiditHost ||
      parsedSessionUrl.username ||
      parsedSessionUrl.password ||
      (parsedSessionUrl.port !== '' && parsedSessionUrl.port !== '443')
    ) {
      console.error('[KYC INITIATE] Verification provider returned an invalid or untrusted session URL.');
      return NextResponse.json({ error: 'Verification service returned an invalid session' }, { status: 502 });
    }

    // Persist the provider session through the trusted atomic RPC. This keeps the
    // profile session, retry counters, and kyc_verifications row in one transaction.
    const { data: initiationResult, error: initiationError } = await supabase.rpc('initiate_didit_kyc', {
      p_user_id: userId,
      p_session_id: sessionId,
    });
    if (initiationError) {
      console.error('[KYC INITIATE] Atomic session registration failed:', initiationError);
      return NextResponse.json({ error: 'Could not save verification session. Please retry or contact support.' }, { status: 500 });
    }
    if (!initiationResult || initiationResult.success !== true) {
      const reason = String(initiationResult?.error || 'session_registration_failed');
      const status = reason === 'max_attempts_exceeded' ? 403 : reason === 'already_in_review' || reason === 'already_verified' ? 409 : 400;
      return NextResponse.json({ error: reason, message: initiationResult?.message || 'Could not register verification session.' }, { status });
    }

    return NextResponse.json({
      success: true,
      url: sessionUrl,
      session_id: sessionId,
      didit_session_id: sessionId,
      status: 'in_review',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
