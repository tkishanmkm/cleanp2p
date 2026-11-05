import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import {
  verifyAdminTOTPToken,
  verifyRecoveryPasswordHash,
  hashRecoveryPassword,
  generateRecoveryPassword,
  logAdminSecurityAudit,
} from '@/lib/admin-security';
import { createAdmin2FASessionToken, setAdmin2FACookie } from '@/lib/admin-2fa-session';
import { checkAdmin2FARateLimit, resetAdmin2FAFailures } from '@/lib/admin-2fa-rate-limit';
import { ensureAdminTOTPSecretEncrypted } from '@/lib/admin-2fa-crypto';

export const dynamic = 'force-dynamic';

const MAX_ADMIN_2FA_BODY_BYTES = 8 * 1024;

async function readAdmin2FARequestBody(req: Request): Promise<string | null> {
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
      if (totalBytes > MAX_ADMIN_2FA_BODY_BYTES) {
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

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required. Please sign in.' },
        { status: 401 }
      );
    }

    const adminId = user.id;
    const adminEmail = user.email || 'admin';
    const adminDb = createAdminClient();

    // 1. Authoritative Admin Role Verification
    const { data: profile, error: profError } = await adminDb
      .from('profiles')
      .select('id, email, role, is_admin, is_admin_account, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status, admin_2fa_enabled, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, admin_2fa_secret, two_factor_secret, admin_2fa_recovery_hash, admin_2fa_recovery_updated_at')
      .eq('id', adminId)
      .single();

    if (profError || !profile) {
      return NextResponse.json({ success: false, error: 'Admin profile not found' }, { status: 404 });
    }

    const profileStatus = String(profile.status || '').trim().toLowerCase();
    const accountStatus = String(profile.account_status || '').trim().toLowerCase();
    const isDisabled = Boolean(
      profile.is_banned ||
      profile.is_suspended ||
      profile.is_restricted ||
      profile.is_on_hold ||
      profile.is_emergency_frozen ||
      profile.is_minor_restricted ||
      profileStatus !== 'active' ||
      ['banned', 'suspended', 'restricted', 'frozen', 'blocked', 'on_hold', 'hold', 'deleted', 'inactive', 'closed', 'deletion_pending'].includes(accountStatus)
    );
    if (isDisabled) {
      return NextResponse.json(
        { success: false, error: 'This administrator account is disabled.' },
        { status: 403 }
      );
    }

    // Use the database's canonical admin resolver. This includes trusted
    // app_admins grants and excludes client-editable user metadata.
    const { data: adminRows, error: adminVerificationError } = await adminDb.rpc(
      'verify_admin_login',
      { user_uuid: adminId }
    );
    if (adminVerificationError) {
      console.error('[ADMIN_2FA_CHALLENGE] Canonical admin lookup failed:', adminVerificationError.code || 'unknown');
      return NextResponse.json(
        { success: false, error: 'Administrator privileges could not be verified.' },
        { status: 503 }
      );
    }
    const adminVerification = Array.isArray(adminRows) ? adminRows[0] : null;
    if (!adminVerification || adminVerification.is_valid !== true || adminVerification.suspended_val === true) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Active administrator privileges are required.' },
        { status: 403 }
      );
    }

    const is2FAEnabled = Boolean(profile.admin_2fa_enabled || profile.is_2fa_enabled);

    // If 2FA is disabled for this admin, they do not need to solve a challenge
    if (!is2FAEnabled) {
      const response = NextResponse.json({
        success: true,
        is2FAEnabled: false,
        message: 'Admin 2FA is not enabled for this account.',
      });
      return response;
    }

    // 2. Persistent, cross-instance rate limiting. Database failures must
    // fail closed so a deployment/restart cannot silently reset brute-force limits.
    let rateLimit;
    try {
      rateLimit = await checkAdmin2FARateLimit(adminId);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Administrator 2FA protection is temporarily unavailable.' },
        { status: 503 }
      );
    }
    if (!rateLimit.allowed) {
      const rateLimitAuditSaved = await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'ADMIN_2FA_CHALLENGE_RATE_LIMITED',
        details: { retryAfterSeconds: rateLimit.retryAfterSeconds },
        ipAddress: 'server-observed',
      });
      if (!rateLimitAuditSaved) {
        return NextResponse.json(
          { success: false, error: 'Rate-limited administrator challenge could not be securely audited.' },
          { status: 503 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: `Too many failed 2FA verification attempts. Please try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutes.`,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    // 3. Parse and validate a tightly bounded credentials-only body.
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_ADMIN_2FA_BODY_BYTES) {
      return NextResponse.json({ success: false, error: '2FA request body is too large.' }, { status: 413 });
    }
    let rawBody: string | null;
    try {
      rawBody = await readAdmin2FARequestBody(req);
    } catch {
      return NextResponse.json({ success: false, error: 'Malformed 2FA request body.' }, { status: 400 });
    }
    if (rawBody === null) {
      return NextResponse.json({ success: false, error: '2FA request body is too large.' }, { status: 413 });
    }
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid object');
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ success: false, error: 'Malformed 2FA request body.' }, { status: 400 });
    }
    if (Object.keys(body).some((key) => key !== 'code' && key !== 'recoveryPassword')) {
      return NextResponse.json({ success: false, error: 'Unsupported 2FA request field.' }, { status: 400 });
    }
    const code = body.code;
    const recoveryPassword = body.recoveryPassword;
    if ((code !== undefined && (typeof code !== 'string' || code.length > 16)) ||
        (recoveryPassword !== undefined && (typeof recoveryPassword !== 'string' || recoveryPassword.length > 64))) {
      return NextResponse.json({ success: false, error: 'Invalid 2FA credential format.' }, { status: 400 });
    }

    if (!code && !recoveryPassword) {
      return NextResponse.json(
        { success: false, error: 'Please enter your 6-digit authenticator code or emergency recovery password.' },
        { status: 400 }
      );
    }

    let isChallengeValid = false;
    let authMethodUsed = '';
    let newRecoveryPassword: string | undefined;

    // A. Verify TOTP Code. Migrate legacy plaintext secrets before use.
    if (code) {
      let encryptedSecret = '';
      try {
        encryptedSecret = await ensureAdminTOTPSecretEncrypted(adminDb, adminId, profile);
      } catch {
        return NextResponse.json({ success: false, error: 'Administrator authenticator could not be securely encrypted and verified.' }, { status: 503 });
      }
      if (!encryptedSecret) {
        return NextResponse.json({ success: false, error: 'Administrator authenticator is unavailable.' }, { status: 503 });
      }
      isChallengeValid = verifyAdminTOTPToken(encryptedSecret, String(code));
      if (isChallengeValid) authMethodUsed = 'totp_code';
    }

    // B. Verify Recovery Password
    if (!isChallengeValid && recoveryPassword && profile.admin_2fa_recovery_hash) {
      isChallengeValid = verifyRecoveryPasswordHash(String(recoveryPassword), profile.admin_2fa_recovery_hash);
      if (isChallengeValid) {
        authMethodUsed = 'recovery_password';

        // Rotate recovery password on emergency use
        newRecoveryPassword = generateRecoveryPassword();
        const newHash = hashRecoveryPassword(newRecoveryPassword);
        const nowIso = new Date().toISOString();

        const { data: rotationResult, error: rotateError } = await adminDb.rpc('rotate_admin_2fa_recovery_atomic', {
          p_admin_id: adminId,
          p_expected_recovery_hash: profile.admin_2fa_recovery_hash,
          p_new_recovery_hash: newHash,
          p_admin_email: adminEmail,
          p_now: nowIso,
        });
        if (rotateError || rotationResult !== true) {
          console.error('[Admin 2FA] Atomic recovery rotation failed:', rotateError?.code || null);
          return NextResponse.json(
            { success: false, error: 'Recovery credential is no longer valid or could not be rotated safely. Use your authenticator code or contact support.' },
            { status: rotateError ? 503 : 409 }
          );
        }
        // The token's version must match the freshly rotated database value.
        profile.admin_2fa_recovery_updated_at = nowIso;
      }
    }

    // 4. Handle Failed Verification
    if (!isChallengeValid) {
      const remaining = rateLimit;

      const failureAuditSaved = await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'ADMIN_2FA_CHALLENGE_FAILED',
        details: { method: code ? 'totp' : 'recovery_password', remainingAttempts: remaining.remainingAttempts },
        ipAddress: 'server-observed',
      });
      if (!failureAuditSaved) {
        return NextResponse.json(
          { success: false, error: 'Authentication failure could not be securely audited.' },
          { status: 503 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid 6-digit authenticator code or recovery password.',
          remainingAttempts: remaining.remainingAttempts,
        },
        { status: 400 }
      );
    }

    // 5. Reset persistent failures and save the audit event before issuing the
    // privileged cookie. If either security control fails, do not grant access.
    try {
      await resetAdmin2FAFailures(adminId);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Administrator 2FA protection could not be reset.' },
        { status: 503 }
      );
    }

    const successAuditSaved = await logAdminSecurityAudit({
      adminId,
      adminEmail,
      action: 'ADMIN_2FA_CHALLENGE_SUCCESS',
      details: { method: authMethodUsed },
      ipAddress: 'server-observed',
    });
    if (!successAuditSaved) {
      return NextResponse.json(
        { success: false, error: 'Administrator 2FA verification could not be securely audited.' },
        { status: 503 }
      );
    }

    // Create cryptographically signed 2FA session token bound to admin security state
    const securityVersion = profile.admin_2fa_recovery_updated_at || profile.id;
    const sessionToken = createAdmin2FASessionToken(adminId, securityVersion);

    const response = NextResponse.json({
      success: true,
      is2FAEnabled: true,
      method: authMethodUsed,
      newRecoveryPassword,
      message: 'Admin 2FA verification successful.',
    });

    // Issue HttpOnly, Secure, SameSite=Lax cookie
    setAdmin2FACookie(response, sessionToken);

    return response;
  } catch (err: any) {
    console.error('Admin 2FA Challenge Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error during 2FA verification.' },
      { status: 500 }
    );
  }
}
