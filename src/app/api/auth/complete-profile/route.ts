import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { extractClientTelemetry, logSecurityEvent } from '@/lib/telemetry';
import { hashSecurityAnswer } from '@/lib/security-answer';

export const dynamic = 'force-dynamic';

const MAX_PROFILE_BODY_BYTES = 16 * 1024;

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
      if (totalBytes > MAX_PROFILE_BODY_BYTES) {
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

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_PROFILE_BODY_BYTES) {
      return NextResponse.json({ error: 'Profile request body is too large.' }, { status: 413 });
    }

    const rawBody = await readBoundedBody(req);
    if (rawBody === null) {
      return NextResponse.json({ error: 'Profile request body is too large.' }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed profile request JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A valid profile object is required.' }, { status: 400 });
    }

    const { name, dob, country, securityQuestion, securityAnswer } = body as Record<string, unknown>;
    if (
      typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120 ||
      !/^[\p{L}\p{M} .'-]+$/u.test(name.trim()) ||
      typeof dob !== 'string' ||
      typeof securityQuestion !== 'string' ||
      securityQuestion.trim().length < 5 || securityQuestion.trim().length > 200 ||
      typeof securityAnswer !== 'string' ||
      securityAnswer.trim().length < 2 || securityAnswer.length > 256
    ) {
      return NextResponse.json({ error: 'Name, valid date of birth, security question and answer are required.' }, { status: 400 });
    }

    const cleanName = name.trim().normalize('NFKC');
    const cleanDob = dob.trim();
    const dobMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanDob);
    if (!dobMatch) {
      return NextResponse.json({ error: 'Date of birth must use YYYY-MM-DD format.' }, { status: 400 });
    }

    const year = Number(dobMatch[1]);
    const month = Number(dobMatch[2]);
    const day = Number(dobMatch[3]);
    const birthDateUtc = new Date(Date.UTC(year, month - 1, day));
    if (
      birthDateUtc.getUTCFullYear() !== year ||
      birthDateUtc.getUTCMonth() + 1 !== month ||
      birthDateUtc.getUTCDate() !== day
    ) {
      return NextResponse.json({ error: 'Date of birth is not a valid calendar date.' }, { status: 400 });
    }

    const today = new Date();
    const todayYear = today.getUTCFullYear();
    const todayMonth = today.getUTCMonth() + 1;
    const todayDay = today.getUTCDate();
    if (birthDateUtc.getTime() > Date.UTC(todayYear, todayMonth - 1, todayDay)) {
      return NextResponse.json({ error: 'Date of birth cannot be in the future.' }, { status: 400 });
    }

    let age = todayYear - year;
    if (todayMonth < month || (todayMonth === month && todayDay < day)) age--;
    if (age < 18) {
      return NextResponse.json({
        error: 'Child Safety Policy: You must be at least 18 years old to use Wayones.',
        isMinor: true,
        code: 'UNDER_18_PROHIBITED',
      }, { status: 403 });
    }

    if (country !== undefined && (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country.trim()))) {
      return NextResponse.json({ error: 'Country must be a valid two-letter ISO code.' }, { status: 400 });
    }

    const currentUserId = user.id;
    const telemetry = extractClientTelemetry(req);
    const adminSupabase = createAdminClient();

    const [duplicateByDob, duplicateByDateOfBirth] = await Promise.all([
      adminSupabase.from('profiles').select('id').neq('id', currentUserId)
        .eq('dob', cleanDob).ilike('full_name', cleanName).limit(1),
      adminSupabase.from('profiles').select('id').neq('id', currentUserId)
        .eq('date_of_birth', cleanDob).ilike('full_name', cleanName).limit(1),
    ]);

    if (duplicateByDob.error || duplicateByDateOfBirth.error) {
      console.error('[PROFILE COMPLETE] Duplicate identity query failed', {
        code: duplicateByDob.error?.code || duplicateByDateOfBirth.error?.code || null,
      });
      return NextResponse.json({ error: 'Identity checks are temporarily unavailable. Please retry.' }, { status: 503 });
    }

    const duplicateProfile = duplicateByDob.data?.[0] || duplicateByDateOfBirth.data?.[0] || null;
    if (duplicateProfile) {
      const { data: suspendedRows, error: suspendError } = await adminSupabase
        .from('profiles')
        .update({
          status: 'suspended',
          is_suspended: true,
          suspension_reason: 'Duplicate identity review required. Contact support for assistance.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentUserId)
        .select('id');

      if (suspendError || !Array.isArray(suspendedRows) || suspendedRows.length !== 1) {
        console.error('[PROFILE COMPLETE] Duplicate identity suspension could not be persisted', {
          code: suspendError?.code || null,
          rows: Array.isArray(suspendedRows) ? suspendedRows.length : null,
        });
        return NextResponse.json({ error: 'Identity review could not be completed. Please contact support.' }, { status: 503 });
      }

      await logSecurityEvent({
        userId: currentUserId,
        targetId: duplicateProfile.id,
        action: 'DUPLICATE_IDENTITY_ONBOARDING_SUSPENDED',
        eventType: 'SUSPICIOUS_IDENTITY_FRAUD',
        ip: telemetry.ip,
        userAgent: telemetry.userAgent,
        browser: telemetry.browser,
        os: telemetry.os,
        deviceType: telemetry.deviceType,
        language: telemetry.language,
        isSuspicious: true,
        suspicionReason: 'A duplicate identity record was detected during profile completion.',
        metadata: { matched_user_id: duplicateProfile.id },
      });

      return NextResponse.json({
        error: 'Registration & profile completion require manual identity review. Please contact support.',
        suspended: true,
      }, { status: 403 });
    }

    const { data: userProfile, error: userProfileError } = await adminSupabase
      .from('profiles')
      .select('username, onboarding_completed, kyc_status, is_verified, id_verified')
      .eq('id', currentUserId)
      .maybeSingle();

    if (userProfileError || !userProfile) {
      return NextResponse.json({ error: 'Could not load your profile.' }, { status: 503 });
    }

    const isKycLocked = ['approved', 'verified'].includes(String(userProfile.kyc_status || '').toLowerCase())
      && userProfile.is_verified === true
      && userProfile.id_verified === true;
    if (isKycLocked) {
      return NextResponse.json({ error: 'Your verified legal identity cannot be changed through onboarding.' }, { status: 403 });
    }

    const securityAnswerHash = await hashSecurityAnswer(securityAnswer);
    const updatePayload: Record<string, unknown> = {
      name: cleanName,
      full_name: cleanName,
      date_of_birth: cleanDob,
      dob: cleanDob,
      security_question: securityQuestion.trim(),
      security_answer: null,
      security_answer_hash: securityAnswerHash,
      terms_accepted_at: new Date().toISOString(),
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    };

    if (userProfile.username) updatePayload.display_name = userProfile.username;
    if (typeof country === 'string') updatePayload.country = country.trim().toUpperCase();

    const { data: updatedProfiles, error: updateError } = await adminSupabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', currentUserId)
      .select('id');

    if (updateError || !Array.isArray(updatedProfiles) || updatedProfiles.length !== 1) {
      console.error('[PROFILE COMPLETE] Profile update failed', {
        code: updateError?.code || null,
        rows: Array.isArray(updatedProfiles) ? updatedProfiles.length : null,
      });
      return NextResponse.json({ error: 'Could not save profile details. Please retry.' }, { status: 503 });
    }

    await logSecurityEvent({
      userId: currentUserId,
      action: 'PROFILE_COMPLETED_SUCCESSFULLY',
      eventType: 'ONBOARDING_COMPLETED',
      ip: telemetry.ip,
      userAgent: telemetry.userAgent,
      browser: telemetry.browser,
      os: telemetry.os,
      deviceType: telemetry.deviceType,
      language: telemetry.language,
      isSuspicious: false,
    });

    return NextResponse.json({ success: true, message: 'Profile completed successfully' });
  } catch (error) {
    console.error('[PROFILE COMPLETE] Request failed', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Could not complete your profile. Please retry.' }, { status: 500 });
  }
}
