import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const MAX_DIDIT_WEBHOOK_BYTES = 2 * 1024 * 1024;

async function readRequestBodyBounded(req: NextRequest): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_DIDIT_WEBHOOK_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Didit webhook Supabase configuration is missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function shortenFloats(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shortenFloats);
  if (v && typeof v === 'object' && v !== null) {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shortenFloats(x)])
    );
  }
  // JSON.parse already normalizes values such as 1.0 to the integer 1;
  // make whole-number handling explicit for the canonical V2 signing payload.
  if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)) return Math.trunc(v);
  return v;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && v !== null) {
    return Object.keys(v as object)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return v;
}

function isApprovedStatus(val: any): boolean {
  if (!val) return false;
  const s = String(val).toLowerCase();
  return s === 'approved' || s === 'passed' || s === 'completed' || s === 'true';
}

// Parse provider DOB values as calendar dates, not local-time Date strings.
// Reject impossible dates and future dates so malformed identity data can never
// silently bypass the platform's 18+ KYC rule.
function getAgeFromDateOnly(value: unknown, now = new Date()): number | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birthUtc = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isFinite(birthUtc.getTime()) ||
    birthUtc.getUTCFullYear() !== year ||
    birthUtc.getUTCMonth() + 1 !== month ||
    birthUtc.getUTCDate() !== day
  ) return null;

  const todayYear = now.getUTCFullYear();
  const todayMonth = now.getUTCMonth() + 1;
  const todayDay = now.getUTCDate();
  if (birthUtc.getTime() > Date.UTC(todayYear, todayMonth - 1, todayDay)) return null;

  let age = todayYear - year;
  if (todayMonth < month || (todayMonth === month && todayDay < day)) age--;
  return age >= 0 ? age : null;
}

function safeProviderText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export async function POST(req: NextRequest) {
  let eventSupabase: any = null;
  let eventClaim: { sessionId: string; eventKey: string; payloadDigest: string; leaseToken: string } | null = null;

  const finishEventClaim = async (success: boolean): Promise<boolean> => {
    if (!eventClaim || !eventSupabase) return true;
    try {
      const { data, error } = await eventSupabase.rpc('finish_didit_webhook_event', {
        p_session_id: eventClaim.sessionId,
        p_event_key: eventClaim.eventKey,
        p_payload_digest: eventClaim.payloadDigest,
        p_lease_token: eventClaim.leaseToken,
        p_success: success,
      });
      if (error || data !== true) {
        console.error('[DIDIT WEBHOOK] Could not finalize durable event claim', { code: error?.code || null, success });
        return false;
      }
      eventClaim = null;
      return true;
    } catch (error) {
      console.error('[DIDIT WEBHOOK] Durable event finalization threw an exception', error);
      return false;
    }
  };

  try {
    const raw = await readRequestBodyBounded(req);
    if (raw === null) {
      return new NextResponse('Webhook payload too large', { status: 413 });
    }
    const sigV2 = (req.headers.get('x-signature-v2') || '').trim();
    const sigV1 = (req.headers.get('x-signature') || '').trim();
    const tsHeader = req.headers.get('x-timestamp');
    // Didit webhook timestamps are Unix seconds expressed as a 10-digit integer.
    // Reject fractions, malformed values, and stale events to prevent replay-window ambiguity.
    if (!tsHeader || !/^\d{10}$/.test(tsHeader.trim())) {
      return new NextResponse('Missing or invalid timestamp', { status: 401 });
    }
    const ts = Number(tsHeader.trim());
    if (!Number.isSafeInteger(ts) || ts <= 0 || Math.abs(Date.now() / 1000 - ts) > 300) {
      return new NextResponse('Stale timestamp', { status: 401 });
    }

    const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[DIDIT WEBHOOK] DIDIT_WEBHOOK_SECRET is not configured');
      return new NextResponse('Webhook secret not configured', { status: 500 });
    }

    // 2. Signature verification
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return new NextResponse('Invalid JSON payload', { status: 400 });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new NextResponse('Invalid JSON payload', { status: 400 });
    }

    // The timestamp inside the signed body must match X-Timestamp; otherwise an attacker
    // could refresh the unsigned header and replay an old, validly signed payload.
    const bodyTimestamp = parsed && typeof parsed === 'object' ? parsed.timestamp : undefined;
    if (bodyTimestamp === undefined || String(bodyTimestamp) !== tsHeader.trim()) {
      return new NextResponse('Timestamp/header mismatch', { status: 401 });
    }

    // Didit exposes two different HMAC formats: V2 signs canonicalized JSON,
    // while the original X-Signature signs the exact raw request bytes. Validate
    // each header only against its own algorithm; never mix the formats.
    const canonicalV2 = JSON.stringify(sortKeys(shortenFloats(parsed)));
    const expectedV2 = crypto
      .createHmac('sha256', webhookSecret)
      .update(canonicalV2, 'utf8')
      .digest();
    const expectedV1 = crypto
      .createHmac('sha256', webhookSecret)
      .update(raw, 'utf8')
      .digest();

    const matchesHmacHex = (provided: string, expected: Buffer): boolean => {
      if (!/^[a-f0-9]{64}$/i.test(provided)) return false;
      const supplied = Buffer.from(provided, 'hex');
      return supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied);
    };

    const validV2 = matchesHmacHex(sigV2, expectedV2);
    const validV1 = matchesHmacHex(sigV1, expectedV1);
    if (!validV2 && !validV1) {
      console.warn('[DIDIT WEBHOOK] Signature mismatch for payload');
      return new NextResponse('Invalid signature', { status: 401 });
    }

    // Treat the registered session as the authority; payload user IDs must match it.
    const payloadUserId = parsed.vendor_data || parsed.client_reference_id || parsed.user_id || parsed.user_data?.user_id;
    const sessionValue = parsed.session_id || parsed.id || parsed.vendor_session_id;
    const sessionId = typeof sessionValue === 'string' ? sessionValue.trim() : '';
    if (!sessionId || sessionId.length > 512) {
      return new NextResponse('Missing or invalid session ID', { status: 400 });
    }

    const supabase = getSupabaseClient();
    eventSupabase = supabase;

    const [profileByDidit, profileByVendor, kycBySession] = await Promise.all([
      supabase.from('profiles').select('id').eq('didit_session_id', sessionId).limit(2),
      supabase.from('profiles').select('id').eq('kyc_vendor_session_id', sessionId).limit(2),
      supabase.from('kyc_verifications').select('user_id').eq('session_id', sessionId).limit(2),
    ]);

    if (profileByDidit.error || profileByVendor.error || kycBySession.error) {
      console.error('[DIDIT WEBHOOK] Unable to verify registered session ownership');
      return new NextResponse('Unable to verify session ownership', { status: 503 });
    }

    const registeredOwners = new Set<string>();
    for (const row of profileByDidit.data || []) registeredOwners.add(row.id);
    for (const row of profileByVendor.data || []) registeredOwners.add(row.id);
    for (const row of kycBySession.data || []) registeredOwners.add(row.user_id);

    if (registeredOwners.size !== 1) {
      console.warn('[DIDIT WEBHOOK] Session is not registered to exactly one user');
      return new NextResponse('Unknown or ambiguous session', { status: 401 });
    }

    const userId = [...registeredOwners][0];
    if (!Array.isArray(kycBySession.data) || kycBySession.data.length !== 1 || kycBySession.data[0]?.user_id !== userId) {
      console.warn('[DIDIT WEBHOOK] Session must map to exactly one verification record');
      return new NextResponse('Unknown or ambiguous verification record', { status: 409 });
    }

    if (payloadUserId !== undefined && payloadUserId !== null && String(payloadUserId) !== userId) {
      console.warn('[DIDIT WEBHOOK] Payload user does not match registered session owner');
      return new NextResponse('Session/user mismatch', { status: 401 });
    }

    // 4. Idempotency Check on event_id
    const eventIdValue = parsed.event_id;
    const eventId = typeof eventIdValue === 'string' ? eventIdValue.trim() : '';
    if (eventIdValue !== undefined && (!eventId || eventId.length > 256)) {
      return new NextResponse('Invalid event ID', { status: 400 });
    }

    // Claim this verified provider event in the database before changing KYC state.
    // If the event ID is absent, a SHA-256 digest of the exact signed request body
    // becomes the idempotency key. Conflicting payloads under the same event ID fail closed.
    // Didit refreshes delivery timestamps on retry in some webhook flows. Exclude
    // the signed delivery timestamp from the idempotency digest while retaining it
    // in the HMAC input above. This keeps a resend of the same event idempotent.
    const stablePayload = { ...parsed };
    delete stablePayload.timestamp;
    const stablePayloadJson = JSON.stringify(sortKeys(shortenFloats(stablePayload)));
    const payloadDigest = crypto.createHash('sha256').update(stablePayloadJson, 'utf8').digest('hex');
    const eventKey = eventId || `sha256:${payloadDigest}`;
    const { data: claimResult, error: claimError } = await supabase.rpc('claim_didit_webhook_event', {
      p_session_id: sessionId,
      p_event_key: eventKey,
      p_payload_digest: payloadDigest,
    });

    if (claimError || !claimResult || typeof claimResult !== 'object') {
      console.error('[DIDIT WEBHOOK] Durable event claim failed', { code: claimError?.code || null });
      return new NextResponse('Unable to claim webhook event', { status: 503 });
    }
    if (claimResult.status === 'duplicate') {
      return new NextResponse(JSON.stringify({ received: true, deduplicated: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (claimResult.status === 'conflict') {
      return new NextResponse('Event ID was reused with a different payload', { status: 409 });
    }
    if (claimResult.status === 'busy') {
      return new NextResponse('Webhook event is already being processed', { status: 503 });
    }
    if (claimResult.status !== 'claimed' || typeof claimResult.lease_token !== 'string') {
      console.error('[DIDIT WEBHOOK] Durable event claim returned an invalid response');
      return new NextResponse('Unable to claim webhook event', { status: 503 });
    }
    eventClaim = {
      sessionId,
      eventKey,
      payloadDigest,
      leaseToken: claimResult.lease_token,
    };

    const applyEventState = async (
      targetUserId: string,
      profilePatch: Record<string, unknown>,
      verificationStatus: string,
      decision: unknown,
      vendorData: Record<string, unknown>
    ): Promise<void> => {
      if (!eventClaim) throw new Error('KYC webhook event lease is unavailable');
      const { data, error } = await supabase.rpc('apply_didit_webhook_state', {
        p_user_id: targetUserId,
        p_session_id: eventClaim.sessionId,
        p_event_key: eventClaim.eventKey,
        p_payload_digest: eventClaim.payloadDigest,
        p_lease_token: eventClaim.leaseToken,
        p_profile_patch: profilePatch,
        p_verification_status: verificationStatus,
        p_decision: decision,
        p_vendor_data: vendorData,
      });
      if (error || !data || data.success !== true || data.processed !== true) {
        console.error('[DIDIT WEBHOOK] Atomic KYC state application failed', { code: error?.code || null });
        throw new Error('Unable to atomically persist KYC decision');
      }
      // The database function updates the profile, verification row, and event
      // ledger in one transaction. The event lease is therefore already finalized.
      eventClaim = null;
    };

    // Store only bounded event metadata. The provider payload contains identity and
    // document data and must not be copied wholesale into the KYC decision/vendor columns.
    const buildVendorData = () => ({
      event_key: eventKey,
      ...(eventId ? { last_event_id: eventId } : {}),
    });

    const eventName = String(parsed.event || parsed.webhook_type || '').toLowerCase();
    const rawStatus = String(parsed.status || parsed.decision?.status || parsed.verification_status || '');
    const normalizedStatus = rawStatus.toLowerCase();

    const overallStatus = rawStatus === 'Approved' || normalizedStatus === 'approved' || eventName.includes('approved')
      ? 'approved'
      : rawStatus === 'Declined' || normalizedStatus === 'declined' || eventName.includes('declined') || eventName.includes('rejected')
      ? 'declined'
      : rawStatus === 'Resubmitted' || normalizedStatus === 'resubmitted'
      ? 'resubmitted'
      : rawStatus === 'Kyc Expired' || normalizedStatus === 'kyc expired' || normalizedStatus === 'kyc_expired'
      ? 'kyc_expired'
      : rawStatus === 'Abandoned' || normalizedStatus === 'abandoned'
      ? 'abandoned'
      : rawStatus === 'Expired' || normalizedStatus === 'expired'
      ? 'expired'
      : rawStatus === 'In Review' || normalizedStatus === 'in review' || normalizedStatus === 'in_review' || eventName.includes('review') || eventName.includes('submitted')
      ? 'in_review'
      : normalizedStatus;

    const safeDecisionSummary = {
      event: eventName.slice(0, 100),
      status: overallStatus.slice(0, 80),
      event_id: eventId || null,
    };

    // 5. Process Decisions
    if (overallStatus === 'approved' || overallStatus === 'completed' || isApprovedStatus(overallStatus)) {
      const decision = parsed.decision || {};

      // Normalize array or object structures for verification checks
      const idVerifications = Array.isArray(decision.id_verifications)
        ? decision.id_verifications
        : decision.id_verification ? [decision.id_verification] : [];

      const livenessChecks = Array.isArray(decision.liveness_checks)
        ? decision.liveness_checks
        : decision.liveness_check ? [decision.liveness_check] : [];

      const faceMatches = Array.isArray(decision.face_matches)
        ? decision.face_matches
        : decision.face_match ? [decision.face_match] : [];

      // If detailed modules are provided, verify they passed
      if (idVerifications.length > 0 || livenessChecks.length > 0 || faceMatches.length > 0) {
        const idPassed = idVerifications.length === 0 || idVerifications.every((v: any) => isApprovedStatus(v.status || v.result || v.decision));
        const livenessPassed = livenessChecks.length === 0 || livenessChecks.every((v: any) => isApprovedStatus(v.status || v.result || v.decision));
        const faceMatchPassed = faceMatches.length === 0 || faceMatches.every((v: any) => isApprovedStatus(v.status || v.result || v.decision));

        if (!idPassed || !livenessPassed || !faceMatchPassed) {
          console.warn(`[DIDIT WEBHOOK] Verification incomplete for user ${userId}: ID=${idPassed}, Liveness=${livenessPassed}, Face=${faceMatchPassed}`);
          await applyEventState(
            userId,
            { kyc_status: 'declined', updated_at: new Date().toISOString() },
            'DECLINED',
            safeDecisionSummary,
            buildVendorData()
          );

          if (!(await finishEventClaim(true))) {
            return new NextResponse('Unable to finalize webhook event', { status: 503 });
          }
          return new NextResponse(JSON.stringify({ message: 'Modules incomplete or unapproved', idPassed, livenessPassed, faceMatchPassed }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // Extract only bounded, typed identity fields from the signed provider payload.
      const primaryCandidate = idVerifications[0] || parsed.extracted_data?.id || parsed.extracted_data || {};
      const primaryId = primaryCandidate && typeof primaryCandidate === 'object' && !Array.isArray(primaryCandidate)
        ? primaryCandidate as Record<string, unknown>
        : {};
      const firstName = safeProviderText(primaryId.first_name || primaryId.firstName, 120);
      const lastName = safeProviderText(primaryId.last_name || primaryId.lastName, 120);
      const extractedFullName = safeProviderText(primaryId.full_name || primaryId.fullName, 256) ||
        `${firstName} ${lastName}`.trim().slice(0, 256);
      const rawDob = safeProviderText(primaryId.date_of_birth || primaryId.dob || primaryId.birth_date, 32);
      const dobMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawDob);
      const parsedDob = dobMatch ? new Date(Date.UTC(Number(dobMatch[1]), Number(dobMatch[2]) - 1, Number(dobMatch[3]))) : null;
      const validDob = Boolean(
        dobMatch && parsedDob &&
        parsedDob.getUTCFullYear() === Number(dobMatch[1]) &&
        parsedDob.getUTCMonth() === Number(dobMatch[2]) - 1 &&
        parsedDob.getUTCDate() === Number(dobMatch[3])
      );
      if (!validDob) {
        console.error('[DIDIT WEBHOOK] Approval payload did not contain a valid ISO date of birth; refusing automatic approval.');
        await finishEventClaim(false);
        return new NextResponse('A valid date of birth is required for KYC approval', { status: 503 });
      }
      const extractedDob: string = rawDob;
      const documentNumber = safeProviderText(primaryId.document_number || primaryId.id_number || primaryId.documentNumber, 128) || null;
      const countryCandidate = safeProviderText(primaryId.issuing_country || primaryId.nationality || primaryId.country, 8).toUpperCase();
      const extractedCountry = /^[A-Z]{2}$/.test(countryCandidate) ? countryCandidate : null;

      const rawAddress = primaryId.address || primaryId.formatted_address || parsed.decision?.address || parsed.decision?.extracted_data?.address || null;
      let extractedAddress: string | null = null;
      if (typeof rawAddress === 'string') {
        extractedAddress = safeProviderText(rawAddress, 600) || null;
      } else if (typeof rawAddress === 'object' && rawAddress !== null && !Array.isArray(rawAddress)) {
        const addressObject = rawAddress as Record<string, unknown>;
        extractedAddress = [
          safeProviderText(addressObject.street_line_1 || addressObject.street, 200),
          safeProviderText(addressObject.city, 120),
          safeProviderText(addressObject.state || addressObject.province, 120),
          safeProviderText(addressObject.postal_code || addressObject.zip_code, 32),
          safeProviderText(addressObject.country, 80),
        ].filter(Boolean).join(', ').slice(0, 600) || null;
      }

      // Child safety age calculation uses UTC calendar dates. A missing or invalid
      // date was rejected above; never allow an unparseable date to bypass the rule.
      const age = getAgeFromDateOnly(extractedDob);
      if (age === null) {
        console.error('[DIDIT WEBHOOK] Date of birth could not be safely evaluated; refusing automatic approval.');
        await finishEventClaim(false);
        return new NextResponse('A valid date of birth is required for KYC approval', { status: 503 });
      }
      if (age < 18) {
        console.error('[DIDIT WEBHOOK] Under-18 KYC decision detected; personal identity details omitted from logs.');

        await applyEventState(
          userId,
          {
            is_banned: true,
            status: 'banned',
            is_suspended: true,
            kyc_status: 'banned',
            suspension_reason: 'No minor allowed for minor safety',
            updated_at: new Date().toISOString(),
          },
          'DECLINED',
          safeDecisionSummary,
          buildVendorData()
        );

        if (!(await finishEventClaim(true))) {
          return new NextResponse('Unable to finalize webhook event', { status: 503 });
        }
        return new NextResponse(JSON.stringify({
          status: 'banned',
          message: 'No minor allowed for minor safety',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Duplicate Prevention Rule: use typed filters rather than constructing raw
      // PostgREST .or() expressions from provider-supplied identity strings. Return
      // only record IDs; never fetch other users' identity or contact details here.
      if (documentNumber || (extractedFullName && extractedDob)) {
        const duplicateLookups: Array<PromiseLike<{ data: Array<{ id: string }> | null; error: any }>> = [];
        if (documentNumber) {
          duplicateLookups.push(
            supabase.from('profiles').select('id')
              .neq('id', userId)
              .eq('id_document_number', documentNumber)
              .limit(1)
          );
        }
        if (extractedFullName && extractedDob) {
          duplicateLookups.push(
            supabase.from('profiles').select('id')
              .neq('id', userId)
              .eq('full_name', extractedFullName)
              .eq('date_of_birth', extractedDob)
              .limit(1)
          );
        }

        if (duplicateLookups.length > 0) {
          const duplicateResults = await Promise.all(duplicateLookups);
          const duplicateLookupError = duplicateResults.find((result) => result.error)?.error;
          const existingMatchCount = duplicateResults.reduce((count, result) => count + (result.data?.length || 0), 0);

          if (duplicateLookupError) {
            console.error('[DIDIT WEBHOOK] Duplicate identity lookup failed; refusing automatic approval', { code: duplicateLookupError.code || null });
            await finishEventClaim(false);
            return new NextResponse('Unable to complete identity uniqueness check', { status: 503 });
          }

          if (existingMatchCount > 0) {
            console.error(`[DIDIT WEBHOOK] Duplicate identity detected for user ${userId}; match count: ${existingMatchCount}. Sensitive identity details omitted from logs.`);

            await applyEventState(
              userId,
              {
                is_banned: true,
                status: 'banned',
                is_suspended: true,
                kyc_status: 'banned',
                suspension_reason: 'Multi-account violation: Attempting KYC with an identity already associated with another account.',
                updated_at: new Date().toISOString(),
              },
              'DECLINED',
              safeDecisionSummary,
              buildVendorData()
            );

            if (!(await finishEventClaim(true))) {
              return new NextResponse('Unable to finalize webhook event', { status: 503 });
            }
            return new NextResponse(JSON.stringify({
              status: 'banned',
              message: 'Duplicate identity detected across multiple accounts. Account permanently banned.',
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
      }

      // Lock and auto-populate full_name, date_of_birth, country, and status in profile
      const updatePayload: Record<string, any> = {
        kyc_status: 'approved',
        is_kyc_locked: true,
        id_verified: true,
        is_verified: true,
        kyc_retry_count: 0,
        kyc_approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (extractedFullName) {
        updatePayload.full_name = extractedFullName;
      }
      if (extractedDob) {
        updatePayload.date_of_birth = extractedDob;
        updatePayload.dob = extractedDob;
      }
      if (documentNumber) {
        updatePayload.id_document_number = documentNumber;
      }
      if (extractedCountry) {
        updatePayload.country = String(extractedCountry).toUpperCase().slice(0, 2);
        updatePayload.is_country_locked = true;
      }
      if (extractedAddress) {
        updatePayload.address = extractedAddress;
        updatePayload.address_street = extractedAddress;
        updatePayload.is_address_locked = true;
      }

      await applyEventState(userId, updatePayload, 'APPROVED', safeDecisionSummary, buildVendorData());

      // Notify User
      try {
        await supabase.from('notifications').insert({
          user_id: userId,
          title: 'KYC Verification Approved',
          message: 'Your identity verification was approved! You now have Tier 2 unlimited trading privileges.',
          type: 'kyc',
          is_read: false,
          metadata: { link: '/settings/identity' },
          created_at: new Date().toISOString(),
        });
      } catch (notifErr) {
        console.warn('Non-fatal: KYC approval notification:', notifErr);
      }

      console.log(`[DIDIT WEBHOOK] KYC successfully approved and locked for user ${userId}`);
    } else if (
      overallStatus === 'in_review' ||
      overallStatus === 'pending' ||
      overallStatus === 'submitted' ||
      overallStatus === 'pending_review'
    ) {
      // User is under review
      await applyEventState(
        userId,
        {
          kyc_status: 'in_review',
          is_verified: false,
          id_verified: false,
          updated_at: new Date().toISOString(),
        },
        'PENDING_REVIEW',
        safeDecisionSummary,
        buildVendorData()
      );

      console.log(`[DIDIT WEBHOOK] User ${userId} KYC marked as in_review.`);
    } else if (overallStatus === 'declined' || overallStatus === 'rejected' || overallStatus === 'failed') {
      // 3-Attempt Retry Logic within 24 hours
      const { data: userProfile, error: userProfileError } = await supabase
        .from('profiles')
        .select('kyc_retry_count, kyc_attempts, kyc_last_attempt_at')
        .eq('id', userId)
        .maybeSingle();

      if (userProfileError || !userProfile) {
        console.error('[DIDIT WEBHOOK] Unable to read KYC retry state', { code: userProfileError?.code || null });
        await finishEventClaim(false);
        return new NextResponse('Unable to verify KYC retry state', { status: 503 });
      }

      const lastAttemptTime = userProfile.kyc_last_attempt_at ? new Date(userProfile.kyc_last_attempt_at).getTime() : 0;
      const hoursSinceLastAttempt = (Date.now() - lastAttemptTime) / (1000 * 60 * 60);

      let currentRetries = Number(userProfile?.kyc_retry_count || userProfile?.kyc_attempts || 0);

      // If more than 24 hours have passed since previous attempt, reset the attempt count
      if (hoursSinceLastAttempt >= 24) {
        currentRetries = 0;
      }

      // initiate_didit_kyc increments the attempt counter when it creates
      // the provider session. A declined webhook records the outcome of that
      // same attempt and must not count the attempt a second time.
      const newRetries = currentRetries;

      if (newRetries >= 3) {
        await applyEventState(
          userId,
          {
            kyc_status: 'permanently_rejected',
            is_verified: false,
            id_verified: false,
            kyc_retry_count: newRetries,
            kyc_attempts: newRetries,
            kyc_last_attempt_at: new Date().toISOString(),
            is_kyc_locked: true,
            suspension_reason: 'KYC failed 3 consecutive times in 24 hours. Contact support for manual verification.',
            updated_at: new Date().toISOString(),
          },
          'SUPPORT_REQUIRED',
          safeDecisionSummary,
          buildVendorData()
        );

        try {
          await supabase.from('notifications').insert({
            user_id: userId,
            title: 'KYC Verification Limit Reached',
            message: 'You have failed 3 verification attempts in 24 hours. Please contact customer support.',
            type: 'kyc',
            is_read: false,
            metadata: { link: '/support?reason=kyc_limit_exceeded' },
            created_at: new Date().toISOString(),
          });
        } catch (notifErr) {
          console.warn('Non-fatal: notification failed:', notifErr);
        }

        console.warn(`[DIDIT WEBHOOK] User ${userId} reached 3 KYC attempts in 24 hours.`);
      } else {
        await applyEventState(
          userId,
          {
            kyc_status: 'declined',
            is_verified: false,
            id_verified: false,
            kyc_retry_count: newRetries,
            kyc_attempts: newRetries,
            kyc_last_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          'DECLINED',
          safeDecisionSummary,
          buildVendorData()
        );

        try {
          await supabase.from('notifications').insert({
            user_id: userId,
            title: 'KYC Verification Declined',
            message: `Your identity verification was declined. You have ${3 - newRetries} attempt(s) remaining in this 24-hour window.`,
            type: 'kyc',
            is_read: false,
            metadata: { link: '/settings/identity' },
            created_at: new Date().toISOString(),
          });
        } catch (notifErr) {
          console.warn('Non-fatal: notification failed:', notifErr);
        }

        console.log(`[DIDIT WEBHOOK] User ${userId} KYC declined. Attempt ${newRetries}/3 recorded.`);
      }
    } else if (overallStatus === 'resubmitted') {
      await applyEventState(
        userId,
        {
          kyc_status: 'resubmit_required',
          is_verified: false,
          id_verified: false,
          updated_at: new Date().toISOString(),
        },
        'RESUBMIT_REQUIRED',
        safeDecisionSummary,
        buildVendorData()
      );

      try {
        await supabase.from('notifications').insert({
          user_id: userId,
          title: 'KYC Resubmission Requested',
          message: 'Automated compliance check requires you to resubmit one or more verification steps. Please visit identity settings.',
          type: 'kyc',
          is_read: false,
          metadata: { link: '/settings/identity' },
          created_at: new Date().toISOString(),
        });
      } catch (notifErr) {
        console.warn('Non-fatal: notification failed:', notifErr);
      }
    } else if (overallStatus === 'kyc_expired') {
      await applyEventState(
        userId,
        {
          kyc_status: 'expired',
          is_verified: false,
          id_verified: false,
          is_kyc_locked: false,
          updated_at: new Date().toISOString(),
        },
        'EXPIRED',
        safeDecisionSummary,
        buildVendorData()
      );

      try {
        await supabase.from('notifications').insert({
          user_id: userId,
          title: 'KYC Verification Expired',
          message: 'Your verification has expired per standard compliance cycle. Please re-verify your identity.',
          type: 'kyc',
          is_read: false,
          metadata: { link: '/settings/identity' },
          created_at: new Date().toISOString(),
        });
      } catch (notifErr) {
        console.warn('Non-fatal: notification failed:', notifErr);
      }
    } else if (overallStatus === 'abandoned' || overallStatus === 'expired') {
      await applyEventState(
        userId,
        {
          kyc_status: overallStatus,
          is_verified: false,
          id_verified: false,
          updated_at: new Date().toISOString(),
        },
        overallStatus.toUpperCase(),
        safeDecisionSummary,
        buildVendorData()
      );
    }

    if (!(await finishEventClaim(true))) {
      return new NextResponse('Unable to finalize webhook event', { status: 503 });
    }
    return new NextResponse(JSON.stringify({ received: true, status: overallStatus }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    if (eventClaim) {
      await finishEventClaim(false);
    }
    console.error('[DIDIT WEBHOOK ERROR]:', err);
    return new NextResponse(JSON.stringify({ error: err.message || 'Internal error' }), { status: 500 });
  }
}

