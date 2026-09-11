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

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const sig = req.headers.get('x-signature-v2') ?? '';
    const ts = Number(req.headers.get('x-timestamp'));

    // 1. Replay attack freshness check (300 seconds)
    if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) {
      return new Response('Stale timestamp', { status: 401 });
    }

    const webhookSecret = process.env.DIDIT_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[DIDIT WEBHOOK] DIDIT_WEBHOOK_SECRET is not configured');
      return new Response('Webhook secret not configured', { status: 500 });
    }

    // 2. Signature verification
    const parsed = JSON.parse(raw);
    const canonical = JSON.stringify(sortKeys(shortenFloats(parsed)));
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(canonical, 'utf8')
      .digest('hex');

    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
      return new Response('Invalid signature', { status: 401 });
    }

    const userId = parsed.vendor_data;
    if (!userId) return new Response('Missing vendor_data', { status: 400 });

    const supabase = getSupabaseClient();

    // 3. Process Decisions
    if (parsed.status === 'Approved') {
      const decision = parsed.decision || {};
      const idVerifications = decision.id_verifications || [];
      const livenessChecks = decision.liveness_checks || [];
      const faceMatches = decision.face_matches || [];

      // Requirement: User must pass ID Verification, Liveness, AND Face Match
      const idPassed = idVerifications.length > 0 && idVerifications.every((v: any) => v.status === 'Approved' || v.status === 'passed');
      const livenessPassed = livenessChecks.length > 0 && livenessChecks.every((v: any) => v.status === 'Approved' || v.status === 'passed');
      const faceMatchPassed = faceMatches.length > 0 && faceMatches.every((v: any) => v.status === 'Approved' || v.status === 'passed');

      if (!idPassed || !livenessPassed || !faceMatchPassed) {
        await supabase.from('profiles').update({ kyc_status: 'declined' }).eq('id', userId);
        return new Response('Modules incomplete or unapproved', { status: 200 });
      }

      // Extract details
      const primaryId = idVerifications[0] || {};
      const firstName = primaryId.first_name || '';
      const lastName = primaryId.last_name || '';
      const extractedFullName = `${firstName} ${lastName}`.trim();
      const extractedDob = primaryId.date_of_birth || null;
      const documentNumber = primaryId.document_number || null;

      // Duplicate Prevention Rule: Check if another account is already verified with this identity
      const { data: existingMatches } = await supabase
        .from('profiles')
        .select('id')
        .neq('id', userId)
        .eq('kyc_status', 'approved')
        .or(`id_document_number.eq.${documentNumber},and(full_name.eq.${extractedFullName},date_of_birth.eq.${extractedDob})`);

      if (existingMatches && existingMatches.length > 0) {
        // DUPLICATE DETECTED: Ban the user immediately
        await supabase.from('profiles').update({
          is_banned: true,
          status: 'banned',
          is_suspended: true,
          kyc_status: 'banned',
          suspension_reason: 'Duplicate identity detected: An approved verified identity with matching government ID or legal name and date of birth is already registered on PaxOnes.',
          updated_at: new Date().toISOString(),
        }).eq('id', userId);

        return new Response('Duplicate identity detected. User banned.', { status: 200 });
      }

      // Lock and auto-populate full_name and date_of_birth in profile
      await supabase.from('profiles').update({
        full_name: extractedFullName,
        date_of_birth: extractedDob,
        id_document_number: documentNumber,
        kyc_status: 'approved',
        is_kyc_locked: true,
      }).eq('id', userId);

    } else if (parsed.status === 'Declined') {
      await supabase.from('profiles').update({ kyc_status: 'declined' }).eq('id', userId);
    }

    return new Response('ok', { status: 200 });
  } catch (err: any) {
    console.error('[DIDIT WEBHOOK ERROR]:', err);
    return new Response('Internal error', { status: 500 });
  }
}
