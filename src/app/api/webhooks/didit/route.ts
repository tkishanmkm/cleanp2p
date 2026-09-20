import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabaseClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'
  );
}

function shortenFloats(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shortenFloats);
  if (v && typeof v === 'object' && v !== null) {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shortenFloats(x)])
    );
  }
  if (typeof v === 'number' && !Number.isInteger(v) && v % 1 === 0) return Math.trunc(v);
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

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const sigV2 = req.headers.get('x-signature-v2');
    const sigV1 = req.headers.get('x-signature');
    const sig = sigV2 || sigV1 || '';
    const tsHeader = req.headers.get('x-timestamp');
    const ts = tsHeader ? Number(tsHeader) : null;

    // 1. Replay attack freshness check (900 seconds / 15 mins for webhook clock skew)
    if (ts && Math.abs(Date.now() / 1000 - ts) > 900) {
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

    const canonical = JSON.stringify(sortKeys(shortenFloats(parsed)));
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(canonical, 'utf8')
      .digest('hex');

    // Also compute fallback raw HMAC in case payload wasn't transformed
    const expectedRaw = crypto
      .createHmac('sha256', webhookSecret)
      .update(raw, 'utf8')
      .digest('hex');

    const isValidV2 = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    const isValidRaw = sig.length === expectedRaw.length && crypto.timingSafeEqual(Buffer.from(expectedRaw), Buffer.from(sig));

    if (!isValidV2 && !isValidRaw) {
      console.warn('[DIDIT WEBHOOK] Signature mismatch for payload');
      return new NextResponse('Invalid signature', { status: 401 });
    }

    // Target user ID from vendor_data, client_reference_id, user_id, or session lookup
    let userId = parsed.vendor_data || parsed.client_reference_id || parsed.user_id || parsed.user_data?.user_id;
    const sessionId = parsed.session_id || parsed.id || parsed.vendor_session_id;

    const supabase = getSupabaseClient();

    if (!userId && sessionId) {
      // Lookup profile by didit_session_id
      const { data: profBySession } = await supabase
        .from('profiles')
        .select('id')
        .or(`didit_session_id.eq.${sessionId},kyc_vendor_session_id.eq.${sessionId}`)
        .maybeSingle();

      if (profBySession?.id) {
        userId = profBySession.id;
      } else {
        const { data: kycBySession } = await supabase
          .from('kyc_verifications')
          .select('user_id')
          .eq('session_id', sessionId)
          .maybeSingle();
        if (kycBySession?.user_id) {
          userId = kycBySession.user_id;
        }
      }
    }

    if (!userId) {
      console.warn('[DIDIT WEBHOOK] Missing user reference in payload, session:', sessionId);
      return new NextResponse(JSON.stringify({ error: 'Missing user reference (vendor_data or session_id)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. Idempotency Check on event_id
    const eventId = parsed.event_id;
    if (eventId) {
      const { data: existingEvent } = await supabase
        .from('kyc_verifications')
        .select('id')
        .eq('session_id', sessionId)
        .contains('vendor_data', { last_event_id: eventId })
        .maybeSingle();

      if (existingEvent) {
        console.log(`[DIDIT WEBHOOK] Event ${eventId} already processed for session ${sessionId}. Skipping duplicate.`);
        return new NextResponse(JSON.stringify({ received: true, deduplicated: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

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
          await supabase.from('profiles').update({
            kyc_status: 'declined',
            updated_at: new Date().toISOString(),
          }).eq('id', userId);

          return new NextResponse(JSON.stringify({ message: 'Modules incomplete or unapproved', idPassed, livenessPassed, faceMatchPassed }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // Extract details from ID OCR
      const primaryId = idVerifications[0] || parsed.extracted_data?.id || parsed.extracted_data || {};
      const firstName = primaryId.first_name || primaryId.firstName || '';
      const lastName = primaryId.last_name || primaryId.lastName || '';
      const extractedFullName = (primaryId.full_name || primaryId.fullName || `${firstName} ${lastName}`).trim();
      const extractedDob = primaryId.date_of_birth || primaryId.dob || primaryId.birth_date || null;
      const documentNumber = primaryId.document_number || primaryId.id_number || primaryId.documentNumber || null;
      const extractedCountry = primaryId.issuing_country || primaryId.nationality || primaryId.country || null;
      
      let rawAddress = primaryId.address || primaryId.formatted_address || parsed.decision?.address || parsed.decision?.extracted_data?.address || null;
      let extractedAddress: string | null = null;
      if (typeof rawAddress === 'string' && rawAddress.trim()) {
        extractedAddress = rawAddress.trim();
      } else if (typeof rawAddress === 'object' && rawAddress !== null) {
        extractedAddress = [
          rawAddress.street_line_1 || rawAddress.street,
          rawAddress.city,
          rawAddress.state || rawAddress.province,
          rawAddress.postal_code || rawAddress.zip_code,
          rawAddress.country
        ].filter(Boolean).join(', ');
      }

      // Child Safety Rule: Under 18 strictly prohibited - immediate permanent ban
      if (extractedDob) {
        const birthDate = new Date(extractedDob);
        if (!isNaN(birthDate.getTime())) {
          const today = new Date();
          let age = today.getFullYear() - birthDate.getFullYear();
          const m = today.getMonth() - birthDate.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }
          if (age < 18) {
            console.error(`[DIDIT WEBHOOK] Under 18 minor detected in KYC for user ${userId}. Age: ${age}, DOB: ${extractedDob}`);

            await supabase.from('profiles').update({
              is_banned: true,
              status: 'banned',
              is_suspended: true,
              kyc_status: 'banned',
              suspension_reason: 'No minor allowed for minor safety',
              updated_at: new Date().toISOString(),
            }).eq('id', userId);

            return new NextResponse(JSON.stringify({
              status: 'banned',
              message: 'No minor allowed for minor safety',
            }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
      }

      // Duplicate Prevention Rule: Check if identity belongs to ANY other account
      if (documentNumber || (extractedFullName && extractedDob)) {
        let duplicateQuery = supabase
          .from('profiles')
          .select('id, email, username, full_name, date_of_birth, id_document_number, kyc_status, is_banned')
          .neq('id', userId);

        const orConditions: string[] = [];
        if (documentNumber) {
          orConditions.push(`id_document_number.eq.${documentNumber}`);
        }
        if (extractedFullName && extractedDob) {
          orConditions.push(`and(full_name.eq.${extractedFullName},date_of_birth.eq.${extractedDob})`);
        }

        if (orConditions.length > 0) {
          const { data: existingMatches } = await duplicateQuery.or(orConditions.join(','));

          if (existingMatches && existingMatches.length > 0) {
            console.error(`[DIDIT WEBHOOK] Duplicate identity detected for user ${userId}. Matching existing user(s):`, existingMatches);

            await supabase.from('profiles').update({
              is_banned: true,
              status: 'banned',
              is_suspended: true,
              kyc_status: 'banned',
              suspension_reason: 'Multi-account violation: Attempting KYC with an identity already associated with another account.',
              updated_at: new Date().toISOString(),
            }).eq('id', userId);

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

      const { error: updateErr } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', userId);

      if (updateErr) {
        console.error('[DIDIT WEBHOOK] Profile update error:', updateErr);
        return new NextResponse(JSON.stringify({ error: updateErr.message }), { status: 500 });
      }

      // Update kyc_verifications table
      if (sessionId) {
        await supabase
          .from('kyc_verifications')
          .update({
            status: 'APPROVED',
            decision: parsed,
            updated_at: new Date().toISOString(),
          })
          .eq('session_id', sessionId);
      }

      // Notify User
      try {
        await supabase.from('notifications').insert({
          user_id: userId,
          title: 'KYC Verification Approved',
          message: 'Your identity verification was approved! You now have Tier 2 unlimited trading privileges.',
          link: '/settings/identity',
          is_read: false,
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
      await supabase.from('profiles').update({
        kyc_status: 'in_review',
        updated_at: new Date().toISOString(),
      }).eq('id', userId);

      if (sessionId) {
        await supabase
          .from('kyc_verifications')
          .update({
            status: 'PENDING_REVIEW',
            decision: parsed,
            updated_at: new Date().toISOString(),
          })
          .eq('session_id', sessionId);
      }

      console.log(`[DIDIT WEBHOOK] User ${userId} KYC marked as in_review.`);
    } else if (overallStatus === 'declined' || overallStatus === 'rejected' || overallStatus === 'failed') {
      // 3-Attempt Retry Logic within 24 hours
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('kyc_retry_count, kyc_attempts, kyc_last_attempt_at')
        .eq('id', userId)
        .maybeSingle();

      const lastAttemptTime = userProfile?.kyc_last_attempt_at ? new Date(userProfile.kyc_last_attempt_at).getTime() : 0;
      const hoursSinceLastAttempt = (Date.now() - lastAttemptTime) / (1000 * 60 * 60);

      let currentRetries = Number(userProfile?.kyc_retry_count || userProfile?.kyc_attempts || 0);

      // If more than 24 hours have passed since previous attempt, reset the attempt count
      if (hoursSinceLastAttempt >= 24) {
        currentRetries = 0;
      }

      const newRetries = currentRetries + 1;

      if (newRetries >= 3) {
        await supabase.from('profiles').update({
          kyc_status: 'permanently_rejected',
          kyc_retry_count: newRetries,
          kyc_attempts: newRetries,
          kyc_last_attempt_at: new Date().toISOString(),
          is_kyc_locked: true,
          suspension_reason: 'KYC failed 3 consecutive times in 24 hours. Contact support for manual verification.',
          updated_at: new Date().toISOString(),
        }).eq('id', userId);

        if (sessionId) {
          await supabase
            .from('kyc_verifications')
            .update({
              status: 'SUPPORT_REQUIRED',
              decision: parsed,
              updated_at: new Date().toISOString(),
            })
            .eq('session_id', sessionId);
        }

        try {
          await supabase.from('notifications').insert({
            user_id: userId,
            title: 'KYC Verification Limit Reached',
            message: 'You have failed 3 verification attempts in 24 hours. Please contact customer support.',
            link: '/support?reason=kyc_limit_exceeded',
            is_read: false,
            created_at: new Date().toISOString(),
          });
        } catch (notifErr) {
          console.warn('Non-fatal: notification failed:', notifErr);
        }

        console.warn(`[DIDIT WEBHOOK] User ${userId} reached 3 KYC attempts in 24 hours.`);
      } else {
        await supabase.from('profiles').update({
          kyc_status: 'declined',
          kyc_retry_count: newRetries,
          kyc_attempts: newRetries,
          kyc_last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', userId);

        if (sessionId) {
          await supabase
            .from('kyc_verifications')
            .update({
              status: 'DECLINED',
              decision: parsed,
              updated_at: new Date().toISOString(),
            })
            .eq('session_id', sessionId);
        }

        try {
          await supabase.from('notifications').insert({
            user_id: userId,
            title: 'KYC Verification Declined',
            message: `Your identity verification was declined. You have ${3 - newRetries} attempt(s) remaining in this 24-hour window.`,
            link: '/settings/identity',
            is_read: false,
            created_at: new Date().toISOString(),
          });
        } catch (notifErr) {
          console.warn('Non-fatal: notification failed:', notifErr);
        }

        console.log(`[DIDIT WEBHOOK] User ${userId} KYC declined. Attempt ${newRetries}/3 recorded.`);
      }
    } else if (overallStatus === 'resubmitted') {
      await supabase.from('profiles').update({
        kyc_status: 'resubmit_required',
        updated_at: new Date().toISOString(),
      }).eq('id', userId);

      if (sessionId) {
        await supabase
          .from('kyc_verifications')
          .update({
            status: 'RESUBMIT_REQUIRED',
            decision: parsed,
            vendor_data: { ...(parsed.vendor_data || {}), resubmit_info: parsed.resubmit_info, last_event_id: eventId },
            updated_at: new Date().toISOString(),
          })
          .eq('session_id', sessionId);
      }

      try {
        await supabase.from('notifications').insert({
          user_id: userId,
          title: 'KYC Resubmission Requested',
          message: 'Automated compliance check requires you to resubmit one or more verification steps. Please visit identity settings.',
          link: '/settings/identity',
          is_read: false,
          created_at: new Date().toISOString(),
        });
      } catch (notifErr) {
        console.warn('Non-fatal: notification failed:', notifErr);
      }
    } else if (overallStatus === 'kyc_expired') {
      await supabase.from('profiles').update({
        kyc_status: 'expired',
        is_verified: false,
        id_verified: false,
        is_kyc_locked: false,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);

      if (sessionId) {
        await supabase
          .from('kyc_verifications')
          .update({
            status: 'EXPIRED',
            decision: parsed,
            updated_at: new Date().toISOString(),
          })
          .eq('session_id', sessionId);
      }

      try {
        await supabase.from('notifications').insert({
          user_id: userId,
          title: 'KYC Verification Expired',
          message: 'Your verification has expired per standard compliance cycle. Please re-verify your identity.',
          link: '/settings/identity',
          is_read: false,
          created_at: new Date().toISOString(),
        });
      } catch (notifErr) {
        console.warn('Non-fatal: notification failed:', notifErr);
      }
    } else if (overallStatus === 'abandoned' || overallStatus === 'expired') {
      if (sessionId) {
        await supabase
          .from('kyc_verifications')
          .update({
            status: overallStatus.toUpperCase(),
            decision: parsed,
            updated_at: new Date().toISOString(),
          })
          .eq('session_id', sessionId);
      }
    }

    return new NextResponse(JSON.stringify({ received: true, status: overallStatus }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[DIDIT WEBHOOK ERROR]:', err);
    return new NextResponse(JSON.stringify({ error: err.message || 'Internal error' }), { status: 500 });
  }
}

