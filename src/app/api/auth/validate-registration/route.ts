import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { extractClientTelemetry, logSecurityEvent } from '@/lib/telemetry';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, dob, email, userId, deviceFingerprint } = body;
    const telemetry = extractClientTelemetry(req);

    if (!name || !dob) {
      return NextResponse.json(
        { error: 'Legal Full Name and Date of Birth are required for registration.' },
        { status: 400 }
      );
    }

    const cleanName = name.trim().toLowerCase();
    const cleanDob = dob.trim();

    const adminSupabase = createAdminClient();

    // Query profiles for existing users with matching full_name and dob
    const { data: existingUsers, error: queryError } = await adminSupabase
      .from('profiles')
      .select('id, full_name, dob, date_of_birth, email, status, is_suspended')
      .neq('status', 'deleted');

    if (queryError) {
      console.error('[REGISTRATION_CHECK] Database query error:', queryError);
    }

    // Check if any existing profile has the same normalized name and DOB
    const duplicateUser = (existingUsers || []).find((p: any) => {
      // Exclude self if checking existing user
      if (userId && p.id === userId) return false;

      const pName = (p.full_name || '').trim().toLowerCase();
      const pDob = (p.dob || p.date_of_birth || '').trim();

      if (!pName || !pDob) return false;

      const nameMatch = pName === cleanName;
      const dobMatch = pDob === cleanDob;

      return nameMatch && dobMatch;
    });

    if (duplicateUser) {
      // Duplicate Identity Violation detected!
      // If a userId was passed (e.g. account was registered or created), suspend it immediately
      if (userId) {
        await adminSupabase
          .from('profiles')
          .update({
            status: 'suspended',
            is_suspended: true,
            suspension_reason: `Duplicate identity violation: Attempted registration with identical name ("${name.trim()}") and date of birth ("${cleanDob}") of existing user.`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId);
      }

      // Record Security Telemetry
      await logSecurityEvent({
        userId: userId || null,
        targetId: duplicateUser.id,
        action: 'DUPLICATE_IDENTITY_REGISTRATION_ATTEMPT_SUSPENDED',
        eventType: 'SUSPICIOUS_REGISTRATION_FRAUD',
        ip: telemetry.ip,
        userAgent: telemetry.userAgent,
        browser: telemetry.browser,
        os: telemetry.os,
        deviceType: telemetry.deviceType,
        deviceFingerprint: deviceFingerprint || 'unknown',
        language: telemetry.language,
        isSuspicious: true,
        suspicionReason: `User attempted to register an account using identical legal name (${name}) and DOB (${dob}) belonging to an existing account (${duplicateUser.id}).`,
        metadata: {
          attempted_name: name.trim(),
          attempted_dob: cleanDob,
          attempted_email: email,
          matched_user_id: duplicateUser.id,
        },
      });

      return NextResponse.json(
        {
          error:
            'Registration Rejected & Account Suspended: An account with this legal name and date of birth is already registered on Paxones. In accordance with platform security and Anti-Fraud policies, duplicate identity accounts are prohibited and have been suspended.',
          suspended: true,
          code: 'DUPLICATE_IDENTITY_SUSPENDED',
        },
        { status: 403 }
      );
    }

    // No duplicate found - log standard registration check telemetry
    await logSecurityEvent({
      userId: userId || null,
      action: 'REGISTRATION_IDENTITY_VALIDATED',
      eventType: 'AUTH_VALIDATION',
      ip: telemetry.ip,
      userAgent: telemetry.userAgent,
      browser: telemetry.browser,
      os: telemetry.os,
      deviceType: telemetry.deviceType,
      deviceFingerprint: deviceFingerprint || 'unknown',
      language: telemetry.language,
      isSuspicious: false,
      metadata: {
        legal_name: name.trim(),
        dob: cleanDob,
        email: email || 'not_provided',
      },
    });

    return NextResponse.json({
      valid: true,
      message: 'Identity validated successfully.',
    });
  } catch (err: any) {
    console.error('[REGISTRATION_CHECK] Server exception:', err);
    return NextResponse.json(
      { error: err.message || 'Server error verifying identity uniqueness.' },
      { status: 500 }
    );
  }
}
