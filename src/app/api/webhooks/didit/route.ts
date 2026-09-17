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

    // 1. Replay attack freshness check (300 seconds)
    if (ts && Math.abs(Date.now() / 1000 - ts) > 300) {
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

    // Target user ID from vendor_data, client_reference_id, or user_id
    const userId = parsed.vendor_data || parsed.client_reference_id || parsed.user_id || parsed.user_data?.user_id;
    if (!userId) {
      return new NextResponse('Missing user reference (vendor_data)', { status: 400 });
    }

    const supabase = getSupabaseClient();

    const overallStatus = String(parsed.status || parsed.decision?.status || parsed.verification_status || '').toLowerCase();

    // 3. Process Decisions
    if (overallStatus === 'approved' || overallStatus === 'completed') {
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

      // Requirement: User must pass ID Verification, 3D Liveness Detection, AND Biometric Face Match
      const idPassed = idVerifications.length > 0 && idVerifications.every((v: any) => isApprovedStatus(v.status || v.result || v.decision));
      const livenessPassed = livenessChecks.length > 0 && livenessChecks.every((v: any) => isApprovedStatus(v.status || v.result || v.decision));
      const faceMatchPassed = faceMatches.length > 0 && faceMatches.every((v: any) => isApprovedStatus(v.status || v.result || v.decision));

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

      // Extract details from ID OCR
      const primaryId = idVerifications[0] || parsed.extracted_data?.id || parsed.extracted_data || {};
      const firstName = primaryId.first_name || primaryId.firstName || '';
      const lastName = primaryId.last_name || primaryId.lastName || '';
      const extractedFullName = (primaryId.full_name || primaryId.fullName || `${firstName} ${lastName}`).trim();
      const extractedDob = primaryId.date_of_birth || primaryId.dob || primaryId.birth_date || null;
      const documentNumber = primaryId.document_number || primaryId.id_number || primaryId.documentNumber || null;
      const extractedCountry = primaryId.issuing_country || primaryId.nationality || primaryId.country || null;

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

      // Duplicate Prevention Rule: Check if identity belongs to ANY other account (approved, banned, or existing)
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

          // DUPLICATE DETECTED: Ban the user immediately with explicit reason
          await supabase.from('profiles').update({
            is_banned: true,
            status: 'banned',
            is_suspended: true,
            kyc_status: 'banned',
            suspension_reason: 'Multi-account violation: Attempting KYC with a government ID or legal identity already associated with another PaxOnes account.',
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

      // Lock and auto-populate full_name, date_of_birth, country, and status in profile
      const updatePayload: Record<string, any> = {
        kyc_status: 'approved',
        is_kyc_locked: true,
        id_verified: true,
        kyc_retry_count: 0,
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

      const { error: updateErr } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', userId);

      if (updateErr) {
        console.error('[DIDIT WEBHOOK] Profile update error:', updateErr);
        return new NextResponse(JSON.stringify({ error: updateErr.message }), { status: 500 });
      }

      console.log(`[DIDIT WEBHOOK] KYC successfully approved and locked for user ${userId}`);
    } else if (overallStatus === 'declined' || overallStatus === 'rejected') {
      // 3-Attempt Retry Logic
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('kyc_retry_count, kyc_attempts')
        .eq('id', userId)
        .maybeSingle();

      const currentRetries = Number(userProfile?.kyc_retry_count || userProfile?.kyc_attempts || 0);
      const newRetries = currentRetries + 1;

      if (newRetries >= 3) {
        await supabase.from('profiles').update({
          kyc_status: 'permanently_rejected',
          kyc_retry_count: newRetries,
          kyc_attempts: newRetries,
          is_kyc_locked: true,
          suspension_reason: 'KYC failed 3 consecutive times. Identity verification is permanently locked.',
          updated_at: new Date().toISOString(),
        }).eq('id', userId);

        console.warn(`[DIDIT WEBHOOK] User ${userId} exceeded 3 KYC attempts. Verification permanently locked.`);
      } else {
        await supabase.from('profiles').update({
          kyc_status: 'rejected',
          kyc_retry_count: newRetries,
          kyc_attempts: newRetries,
          updated_at: new Date().toISOString(),
        }).eq('id', userId);

        console.log(`[DIDIT WEBHOOK] User ${userId} KYC rejected. Attempt ${newRetries}/3 recorded.`);
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

