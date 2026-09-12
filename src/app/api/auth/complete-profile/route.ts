import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { extractClientTelemetry, logSecurityEvent } from '@/lib/telemetry';
import crypto from 'crypto';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, email, dob, country, securityQuestion, securityAnswer } = await req.json();

    if (!name || !dob || !securityQuestion || !securityAnswer) {
      return NextResponse.json({ error: 'Name, Date of Birth, and Security Question & Answer are required' }, { status: 400 });
    }

    const cleanName = name.trim().toLowerCase();
    const cleanDob = dob.trim();

    // Minor child safety check (18+ required)
    const birthDate = new Date(cleanDob);
    if (!isNaN(birthDate.getTime())) {
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      if (age < 18) {
        return NextResponse.json({
          error: 'Child Safety Policy: You must be at least 18 years old to use Paxones.',
          isMinor: true,
          code: 'UNDER_18_PROHIBITED'
        }, { status: 403 });
      }
    }

    const currentUserId = session.user.id;
    const telemetry = extractClientTelemetry(req);

    // Duplicate Identity Verification across all profiles
    const adminSupabase = createAdminClient();
    const { data: existingProfiles } = await adminSupabase
      .from('profiles')
      .select('id, full_name, dob, date_of_birth, status')
      .neq('id', currentUserId)
      .neq('status', 'deleted');

    const duplicateProfile = (existingProfiles || []).find((p: any) => {
      const pName = (p.full_name || '').trim().toLowerCase();
      const pDob = (p.dob || p.date_of_birth || '').trim();
      return pName && pDob && pName === cleanName && pDob === cleanDob;
    });

    if (duplicateProfile) {
      // Suspend current offending account
      await adminSupabase
        .from('profiles')
        .update({
          status: 'suspended',
          is_suspended: true,
          suspension_reason: `Duplicate identity violation: Profile onboarding attempted with identical name ("${name.trim()}") and date of birth ("${cleanDob}") of existing user (${duplicateProfile.id}).`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentUserId);

      // Log Security Telemetry
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
        suspicionReason: `User attempted to set profile with duplicate legal name (${name}) and DOB (${dob}) matching existing user ${duplicateProfile.id}.`,
        metadata: {
          attempted_name: name.trim(),
          attempted_dob: cleanDob,
          matched_user_id: duplicateProfile.id,
        },
      });

      return NextResponse.json(
        {
          error:
            'Registration & Profile Rejected: An account with this legal name and date of birth is already registered on Paxones. In accordance with platform security and anti-fraud policies, duplicate accounts are prohibited and this account has been suspended.',
          suspended: true,
        },
        { status: 403 }
      );
    }

    // Hash the security answer for protection
    const securityAnswerHash = crypto.createHash('sha256').update(securityAnswer.trim().toLowerCase()).digest('hex');

    // Retrieve existing profile to preserve username as display_name
    const { data: userProfile } = await adminSupabase
      .from('profiles')
      .select('username')
      .eq('id', currentUserId)
      .maybeSingle();

    const usernameDisplayName = userProfile?.username || undefined;

    const updatePayload: Record<string, any> = {
      name: (name || '').trim(),
      full_name: (name || '').trim(),
      date_of_birth: cleanDob,
      dob: cleanDob,
      security_question: securityQuestion,
      security_answer: securityAnswer.trim().toLowerCase(),
      security_answer_hash: securityAnswerHash,
      terms_accepted_at: new Date().toISOString(),
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    };

    if (usernameDisplayName) {
      updatePayload.display_name = usernameDisplayName;
    }

    if (country) updatePayload.country = country;
    if (email && email.trim()) updatePayload.email = email.trim();

    const { error } = await adminSupabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', currentUserId);

    if (error) throw error;

    // Log telemetry for successful profile completion
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
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
