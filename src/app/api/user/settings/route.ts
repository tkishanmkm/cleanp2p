import { NextResponse, type NextRequest } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { verify2FAOTP } from '@/lib/2fa';
import { ensureUserTOTPSecretEncrypted } from '@/lib/user-2fa-crypto';


import { hashSecurityAnswer } from '@/lib/security-answer';
import { checkUser2FARateLimit, resetUser2FAFailures, type UserTwoFactorRateLimit } from '@/lib/user-2fa-rate-limit';

const SETTINGS_PROFILE_COLUMNS = 'id, username, display_name, name, full_name, email, avatar_url, photo_url, country, preferred_currency, name_visibility, dob, date_of_birth, is_country_locked, is_address_locked, address, address_street, address_city, address_postal_code, security_question, onboarding_completed, username_changed, username_changes_remaining, username_changed_count, is_verified, id_verified, kyc_status, is_kyc_locked, kyc_retry_count, kyc_attempts, kyc_last_attempt_at, kyc_submitted_at, kyc_approved_at, kyc_retry_after, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, is_online, last_seen_at, created_at, updated_at, avg_payment_time_mins, avg_payment_minutes, avg_pay_time, avg_release_time_mins, avg_release_minutes, avg_release_time, total_completed_trades, completed_trades, total_volume_usd, positive_feedback, negative_feedback, feedback_score, merchant_tier, merchant_applied_tier, merchant_status, merchant_deposit_usdt';
const SUPPORTED_LANGUAGES = new Set(['en', 'ar', 'es', 'fr', 'hi', 'ko', 'pt-BR', 'ru', 'vi', 'zh-CN', 'zh-TW']);
const RESERVED_USERNAMES = ['admin', 'support', 'help', 'system', 'official', 'security', 'p2p', 'moderator'];

const MAX_SETTINGS_BODY_BYTES = 16 * 1024;

async function readSettingsBody(req: Request): Promise<string | null> {
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
      if (totalBytes > MAX_SETTINGS_BODY_BYTES) {
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

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = getSupabaseAdminClient();
    const { data: profile, error } = await admin
      .from('profiles')
      .select(SETTINGS_PROFILE_COLUMNS)
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error fetching profile in /api/user/settings:', error);
      return NextResponse.json({ error: 'Failed to retrieve profile' }, { status: 500 });
    }

    // Determine auth provider
    const provider = user.app_metadata?.provider || 
                     (user.identities && user.identities[0]?.provider) || 
                     'email';

    const sanitizedProfile = profile ? {
      ...profile,
      username_changed: Boolean(profile.username_changed),
      username_changed_count: typeof profile.username_changed_count === 'number' ? profile.username_changed_count : (profile.username_changed ? 1 : 0),
      username_changes_remaining: typeof profile.username_changes_remaining === 'number' ? profile.username_changes_remaining : (profile.username_changed ? 0 : 1),
    } : {
      id: user.id,
      username: user.email?.split('@')[0] || `user_${user.id.slice(0, 6)}`,
      full_name: '',
      country: 'IN',
      preferred_currency: 'USD',
      dob: null,
      name_visibility: 'FULL',
      account_status: 'ACTIVE',
      kyc_status: 'NOT_STARTED',
      is_2fa_enabled: false,
      avatar_url: null,
      photo_url: null,
      username_changed: false,
      username_changed_count: 0,
      username_changes_remaining: 1,
    };

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        auth_provider: provider,
      },
      profile: sanitizedProfile,
    }, {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
        Pragma: 'no-cache',
        Vary: 'Cookie, Authorization',
      },
    });
  } catch (err: any) {
    console.error('GET /api/user/settings unexpected error:', err instanceof Error ? err.name : 'UnknownError');
    return NextResponse.json({ error: 'Could not load account settings.' }, {
      status: 500,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_SETTINGS_BODY_BYTES) {
      return NextResponse.json({ error: 'Settings request is too large.' }, { status: 413 });
    }
    const rawBody = await readSettingsBody(req);
    if (rawBody === null) {
      return NextResponse.json({ error: 'Settings request is too large.' }, { status: 413 });
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed settings request.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid settings request.' }, { status: 400 });
    }
    const { field, data } = body as Record<string, any>;

    if (!field || typeof field !== 'string') {
      return NextResponse.json({ error: 'Missing target setting field' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    switch (field) {
      case 'username': {
        const rawValue = data?.username;
        const rawUsername = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
        if (!/^[a-z0-9._]{3,25}$/.test(rawUsername)) {
          return NextResponse.json({
            error: 'Username must be 3-25 characters and contain only lowercase letters, numbers, dots, and underscores.',
          }, { status: 400 });
        }
        if (RESERVED_USERNAMES.includes(rawUsername)) {
          return NextResponse.json({ error: 'This username is reserved by the platform.' }, { status: 400 });
        }

        const { data: currentProfile, error: currentProfileError } = await admin
          .from('profiles')
          .select('id, username, username_changed, username_changed_count, username_changes_remaining')
          .eq('id', user.id)
          .maybeSingle();

        if (currentProfileError || !currentProfile) {
          return NextResponse.json({ error: 'Could not load username settings.' }, { status: 503 });
        }

        const isLocked = currentProfile.username_changed === true ||
          (typeof currentProfile.username_changed_count === 'number' && currentProfile.username_changed_count >= 1) ||
          (typeof currentProfile.username_changes_remaining === 'number' && currentProfile.username_changes_remaining <= 0);
        if (isLocked) {
          return NextResponse.json({
            error: 'You can only change your username one time after your autogenerated username. Your handle is permanently locked.',
          }, { status: 403 });
        }

        if (typeof currentProfile.username === 'string' && currentProfile.username.toLowerCase() === rawUsername) {
          return NextResponse.json({ error: 'New username must be different from your current handle.' }, { status: 400 });
        }

        const { data: existing, error: existingError } = await admin
          .from('profiles')
          .select('id')
          .ilike('username', rawUsername)
          .neq('id', user.id)
          .limit(1)
          .maybeSingle();

        if (existingError) {
          console.error('[SETTINGS] Username availability check failed', { code: existingError.code || null });
          return NextResponse.json({ error: 'Username availability could not be verified.' }, { status: 503 });
        }
        if (existing) {
          return NextResponse.json({ error: 'This username is already taken by another trader.' }, { status: 409 });
        }

        const { data: updatedRows, error: updateErr } = await admin
          .from('profiles')
          .update({
            username: rawUsername,
            display_name: rawUsername,
            username_changed: true,
            username_changed_count: 1,
            username_changes_remaining: 0,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id)
          .select('id');

        if (updateErr || !Array.isArray(updatedRows) || updatedRows.length !== 1) {
          if (updateErr?.code === '23505') {
            return NextResponse.json({ error: 'This username is already taken by another trader.' }, { status: 409 });
          }
          console.error('[SETTINGS] Username update failed', {
            code: updateErr?.code || null,
            rows: Array.isArray(updatedRows) ? updatedRows.length : null,
          });
          return NextResponse.json({ error: 'Could not save username.' }, { status: 503 });
        }

        // The profile is canonical. Metadata/ad caches are best-effort projections;
        // inspect returned Supabase errors explicitly because they do not throw.
        const { error: metadataError } = await admin.auth.admin.updateUserById(user.id, {
          user_metadata: { username: rawUsername, display_name: rawUsername },
        });
        if (metadataError) {
          console.warn('[SETTINGS] Username Auth metadata projection failed', { code: metadataError.code || null });
        }

        const { error: adsError } = await admin
          .from('p2p_ads')
          .update({ user_display_name: rawUsername })
          .eq('user_id', user.id);
        if (adsError) {
          console.warn('[SETTINGS] Username ad projection failed', { code: adsError.code || null });
        }

        return NextResponse.json({
          success: true,
          field,
          updatedValue: rawUsername,
          projectionsUpdated: !metadataError && !adsError,
          message: 'Username updated successfully.',
        });
      }

      case 'avatar': {
        const rawAvatarUrl = data?.avatarUrl;
        let avatarUrl: string | null = null;
        if (rawAvatarUrl !== null && rawAvatarUrl !== undefined && rawAvatarUrl !== '') {
          if (typeof rawAvatarUrl !== 'string' || rawAvatarUrl.length > 2048) {
            return NextResponse.json({ error: 'Invalid avatar URL.' }, { status: 400 });
          }
          try {
            const parsedAvatar = new URL(rawAvatarUrl);
            if (parsedAvatar.protocol !== 'https:' || parsedAvatar.username || parsedAvatar.password) {
              return NextResponse.json({ error: 'Avatar URLs must use secure HTTPS links.' }, { status: 400 });
            }
            avatarUrl = parsedAvatar.toString();
          } catch {
            return NextResponse.json({ error: 'Invalid avatar URL.' }, { status: 400 });
          }
        }

        const { data: updatedRows, error: updateErr } = await admin
          .from('profiles')
          .update({
            avatar_url: avatarUrl,
            photo_url: avatarUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id)
          .select('id');

        if (updateErr || !Array.isArray(updatedRows) || updatedRows.length !== 1) {
          console.error('[SETTINGS] Avatar update failed', {
            code: updateErr?.code || null,
            rows: Array.isArray(updatedRows) ? updatedRows.length : null,
          });
          return NextResponse.json({ error: 'Could not save profile picture.' }, { status: 503 });
        }

        const { error: metadataError } = await admin.auth.admin.updateUserById(user.id, {
          user_metadata: {
            avatar_url: avatarUrl,
            photo_url: avatarUrl,
            picture: avatarUrl,
            photoURL: avatarUrl,
          },
        });
        if (metadataError) {
          console.warn('[SETTINGS] Avatar Auth metadata projection failed', { code: metadataError.code || null });
        }

        return NextResponse.json({
          success: true,
          field,
          updatedValue: avatarUrl,
          message: 'Profile picture updated successfully.',
          metadataUpdated: !metadataError,
        });
      }

      case 'personal_info': {
        const { fullName, dob, nameVisibility } = data || {};
        if (nameVisibility !== undefined && !['FULL', 'PARTIAL', 'HIDE'].includes(nameVisibility)) {
          return NextResponse.json({ error: 'Invalid name visibility setting.' }, { status: 400 });
        }
        if (fullName !== undefined && (
          typeof fullName !== 'string' ||
          (fullName.trim().length > 0 && (
            fullName.trim().length < 2 ||
            fullName.trim().length > 120 ||
            !/^[\p{L}\p{M} .'-]+$/u.test(fullName.trim())
          ))
        )) {
          return NextResponse.json({ error: 'Full name must contain 2 to 120 valid characters.' }, { status: 400 });
        }

        let normalizedDob: string | null | undefined;
        if (dob !== undefined) {
          if (dob === '') {
            normalizedDob = null;
          } else if (typeof dob === 'string') {
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
            if (!match) {
              return NextResponse.json({ error: 'Date of birth must use YYYY-MM-DD format.' }, { status: 400 });
            }
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            const parsed = new Date(Date.UTC(year, month - 1, day));
            if (
              parsed.getUTCFullYear() !== year ||
              parsed.getUTCMonth() + 1 !== month ||
              parsed.getUTCDate() !== day
            ) {
              return NextResponse.json({ error: 'Date of birth is not a valid calendar date.' }, { status: 400 });
            }
            const today = new Date();
            const currentYear = today.getUTCFullYear();
            const currentMonth = today.getUTCMonth() + 1;
            const currentDay = today.getUTCDate();
            if (parsed.getTime() > Date.UTC(currentYear, currentMonth - 1, currentDay)) {
              return NextResponse.json({ error: 'Date of birth cannot be in the future.' }, { status: 400 });
            }
            let age = currentYear - year;
            if (currentMonth < month || (currentMonth === month && currentDay < day)) age--;
            if (age < 18) {
              return NextResponse.json({
                error: 'No minors allowed: You must be at least 18 years old to trade on Wayones.',
                isMinor: true,
              }, { status: 400 });
            }
            normalizedDob = dob;
          } else {
            return NextResponse.json({ error: 'Invalid date of birth.' }, { status: 400 });
          }
        }

        const { data: prof, error: profileError } = await admin
          .from('profiles')
          .select('kyc_status, is_verified, id_verified, is_kyc_locked, full_name, dob, date_of_birth')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError || !prof) {
          return NextResponse.json({ error: 'Could not load account profile.' }, { status: 503 });
        }

        const isKycVerified = ['verified', 'approved'].includes(String(prof.kyc_status || '').toLowerCase())
          && prof.is_verified === true
          && prof.id_verified === true;

        if ((isKycVerified || prof.is_kyc_locked === true) && (fullName !== undefined || dob !== undefined)) {
          return NextResponse.json(
            { error: 'Your legal name and date of birth are locked by your verified identity documents.' },
            { status: 403 }
          );
        }

        const updates: Record<string, unknown> = {
          ...(nameVisibility !== undefined ? { name_visibility: nameVisibility } : {}),
          updated_at: new Date().toISOString(),
        };

        if (!isKycVerified && prof.is_kyc_locked !== true) {
          const targetName = fullName !== undefined ? fullName.trim() : (prof.full_name || '').trim();
          const targetDob = normalizedDob !== undefined
            ? normalizedDob
            : String(prof.dob || prof.date_of_birth || '');

          if (targetName && targetDob) {
            const [duplicateDob, duplicateDateOfBirth] = await Promise.all([
              admin.from('profiles').select('id').neq('id', user.id)
                .eq('dob', targetDob).ilike('full_name', targetName).limit(1),
              admin.from('profiles').select('id').neq('id', user.id)
                .eq('date_of_birth', targetDob).ilike('full_name', targetName).limit(1),
            ]);

            if (duplicateDob.error || duplicateDateOfBirth.error) {
              console.error('[SETTINGS] Duplicate identity lookup failed', {
                code: duplicateDob.error?.code || duplicateDateOfBirth.error?.code || null,
              });
              return NextResponse.json({ error: 'Identity checks are temporarily unavailable.' }, { status: 503 });
            }

            const match = duplicateDob.data?.[0] || duplicateDateOfBirth.data?.[0];
            if (match) {
              const { data: suspendedRows, error: suspendError } = await admin
                .from('profiles')
                .update({
                  status: 'suspended',
                  is_suspended: true,
                  suspension_reason: 'Duplicate identity review required. Contact support for assistance.',
                  updated_at: new Date().toISOString(),
                })
                .eq('id', user.id)
                .select('id');

              if (suspendError || !Array.isArray(suspendedRows) || suspendedRows.length !== 1) {
                console.error('[SETTINGS] Duplicate identity suspension failed', { code: suspendError?.code || null });
                return NextResponse.json({ error: 'Identity review could not be completed. Please contact support.' }, { status: 503 });
              }

              return NextResponse.json({
                error: 'Duplicate identity detected. Your account requires manual review.',
                suspended: true,
              }, { status: 403 });
            }
          }

          if (fullName !== undefined) updates.full_name = fullName.trim() || null;
          if (normalizedDob !== undefined) {
            updates.dob = normalizedDob;
            updates.date_of_birth = normalizedDob;
          }
        }

        const { data: updatedRows, error: updateErr } = await admin
          .from('profiles')
          .update(updates)
          .eq('id', user.id)
          .select('id');

        if (updateErr || !Array.isArray(updatedRows) || updatedRows.length !== 1) {
          console.error('[SETTINGS] Personal information update failed', {
            code: updateErr?.code || null,
            rows: Array.isArray(updatedRows) ? updatedRows.length : null,
          });
          return NextResponse.json({ error: 'Could not save personal information.' }, { status: 503 });
        }

        return NextResponse.json({
          success: true,
          field,
          message: isKycVerified || prof.is_kyc_locked === true
            ? 'Privacy preference saved. Your verified legal name and date of birth remain locked.'
            : 'Personal information saved successfully.',
        });
      }

      case 'country': {
        const rawCountry = data?.country;
        const newCountry = typeof rawCountry === 'string' ? rawCountry.trim().toUpperCase() : '';
        if (!/^[A-Z]{2}$/.test(newCountry)) {
          return NextResponse.json({ error: 'Country must be a valid two-letter ISO code.' }, { status: 400 });
        }

        const { data: prof, error: profileError } = await admin
          .from('profiles')
          .select('is_country_locked, kyc_status, is_verified, id_verified')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError || !prof) {
          return NextResponse.json({ error: 'Could not load account country settings.' }, { status: 503 });
        }

        const isVerified = ['approved', 'verified'].includes(String(prof.kyc_status || '').toLowerCase())
          && prof.is_verified === true
          && prof.id_verified === true;
        if (prof.is_country_locked === true || isVerified) {
          return NextResponse.json({
            error: 'Your country is locked to your verified identity document. Contact support for assistance.',
          }, { status: 403 });
        }

        const { data: updatedRows, error: updateErr } = await admin
          .from('profiles')
          .update({ country: newCountry, updated_at: new Date().toISOString() })
          .eq('id', user.id)
          .select('id');

        if (updateErr || !Array.isArray(updatedRows) || updatedRows.length !== 1) {
          console.error('[SETTINGS] Country update failed', { code: updateErr?.code || null });
          return NextResponse.json({ error: 'Could not save country preference.' }, { status: 503 });
        }

        return NextResponse.json({ success: true, field, updatedValue: newCountry, message: 'Country updated successfully.' });
      }

      case 'currency': {
        const rawCurrency = data?.currency;
        const currency = typeof rawCurrency === 'string' ? rawCurrency.trim().toUpperCase() : '';
        if (!/^[A-Z]{3}$/.test(currency)) {
          return NextResponse.json({ error: 'Currency must be a three-letter ISO 4217 code.' }, { status: 400 });
        }

        const { data: updatedRows, error: updateErr } = await admin
          .from('profiles')
          .update({ preferred_currency: currency, updated_at: new Date().toISOString() })
          .eq('id', user.id)
          .select('id');

        if (updateErr || !Array.isArray(updatedRows) || updatedRows.length !== 1) {
          console.error('[SETTINGS] Currency update failed', { code: updateErr?.code || null });
          return NextResponse.json({ error: 'Could not save currency preference.' }, { status: 503 });
        }

        return NextResponse.json({ success: true, field, updatedValue: currency, message: 'Preferred currency updated.' });
      }

      case 'security_question': {
        const { question, answer, code } = data || {};
        if (
          typeof question !== 'string' ||
          question.trim().length < 5 ||
          question.trim().length > 200
        ) {
          return NextResponse.json({ error: 'Security question must contain between 5 and 200 characters.' }, { status: 400 });
        }
        if (typeof answer !== 'string' || answer.trim().length < 2 || answer.length > 256) {
          return NextResponse.json({ error: 'Security answer must contain between 2 and 256 characters.' }, { status: 400 });
        }

        const { data: currentProf, error: profileError } = await admin
          .from('profiles')
          .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret, role, is_admin, is_admin_account, admin_2fa_enabled')
          .eq('id', user.id)
          .maybeSingle();

        if (profileError || !currentProf) {
          return NextResponse.json({ error: 'Could not load account security settings.' }, { status: 503 });
        }

        const is2faActive = Boolean(currentProf.is_2fa_enabled || currentProf.is_mfa_enabled || currentProf.two_factor_enabled);
        let encryptedUserSecret = '';

        if (is2faActive) {
          try {
            encryptedUserSecret = await ensureUserTOTPSecretEncrypted(admin, user.id, currentProf);
          } catch {
            return NextResponse.json({ error: 'Account authenticator could not be securely encrypted and verified.' }, { status: 503 });
          }
          if (!encryptedUserSecret) {
            return NextResponse.json({ error: 'Account authenticator is unavailable.' }, { status: 503 });
          }
          let rateLimit: UserTwoFactorRateLimit;
          try {
            rateLimit = await checkUser2FARateLimit(user.id);
          } catch {
            return NextResponse.json({ error: 'Two-factor protection is temporarily unavailable.' }, { status: 503 });
          }

          if (!rateLimit.allowed) {
            const { error: auditError } = await admin.from('user_security_audit_logs').insert({
              user_id: user.id,
              action: '2fa_rate_limited',
              details: { endpoint: '/api/user/settings', operation: 'security_question', retryAfterSeconds: rateLimit.retryAfterSeconds },
            });
            if (auditError) return NextResponse.json({ error: 'Rate-limited attempt could not be securely audited.' }, { status: 503 });
            return NextResponse.json({ error: 'Too many 2FA attempts. Please try again later.' }, {
              status: 429,
              headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
            });
          }

          const cleanCode = typeof code === 'string' ? code.trim() : '';
          if (!/^\d{6}$/.test(cleanCode) || !encryptedUserSecret || !verify2FAOTP(encryptedUserSecret, cleanCode, true)) {
            const { error: auditError } = await admin.from('user_security_audit_logs').insert({
              user_id: user.id,
              action: '2fa_settings_verification_failed',
              details: { operation: 'security_question', reason: !/^\d{6}$/.test(cleanCode) ? 'invalid_format' : 'invalid_code' },
            });
            if (auditError) return NextResponse.json({ error: 'Failed attempt could not be securely audited.' }, { status: 503 });
            return NextResponse.json({
              error: 'A valid 6-digit 2FA code is required to modify security questions.',
              requires2FA: true,
            }, { status: 401 });
          }

          try {
            await resetUser2FAFailures(user.id);
          } catch {
            return NextResponse.json({ error: 'Two-factor protection could not be reset.' }, { status: 503 });
          }
        }

        const securityAnswerHash = await hashSecurityAnswer(answer);
        const { data: updatedRows, error: updateErr } = await admin
          .from('profiles')
          .update({
            security_question: question.trim(),
            security_answer_hash: securityAnswerHash,
            security_answer: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id)
          .select('id');

        if (updateErr || !Array.isArray(updatedRows) || updatedRows.length !== 1) {
          console.error('[SETTINGS] Security answer update failed', {
            code: updateErr?.code || null,
            rows: Array.isArray(updatedRows) ? updatedRows.length : null,
          });
          return NextResponse.json({ error: 'Could not securely save your security question and answer.' }, { status: 503 });
        }

        return NextResponse.json({ success: true, field, message: 'Security question saved successfully.' });
      }

      case 'two_factor': {
        // Direct client-supplied TOTP secrets and unmetered profile writes are
        // retired. Use the pending-enrollment verification or atomic disable API.
        return NextResponse.json({
          error: 'Direct Settings-based 2FA changes are disabled. Use the secure authenticator enrollment or disable flow.',
        }, {
          status: 410,
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        });
      }

      case 'preferences': {
        const { language, timezone, autoReplyMessage, notifications } = data || {};

        if (language !== undefined && (
          typeof language !== 'string' || !SUPPORTED_LANGUAGES.has(language)
        )) {
          return NextResponse.json({ error: 'Unsupported application language.' }, { status: 400 });
        }
        if (timezone !== undefined && (
          typeof timezone !== 'string' || timezone.length < 3 || timezone.length > 80
        )) {
          return NextResponse.json({ error: 'Invalid timezone preference.' }, { status: 400 });
        }
        if (autoReplyMessage !== undefined && (
          typeof autoReplyMessage !== 'string' || autoReplyMessage.length > 500
        )) {
          return NextResponse.json({ error: 'Auto-reply message must not exceed 500 characters.' }, { status: 400 });
        }
        const allowedNotificationKeys = new Set([
          'email_trade_requests',
          'email_escrow_deposit',
          'email_payment_sent',
          'email_release_confirmation',
          'chat_messages',
          'sound_alerts',
          'marketing_updates',
        ]);
        if (notifications !== undefined) {
          if (!notifications || typeof notifications !== 'object' || Array.isArray(notifications)) {
            return NextResponse.json({ error: 'Invalid notification preferences.' }, { status: 400 });
          }
          const entries = Object.entries(notifications as Record<string, unknown>);
          if (entries.length > allowedNotificationKeys.size || entries.some(
            ([key, value]) => !allowedNotificationKeys.has(key) || typeof value !== 'boolean'
          )) {
            return NextResponse.json({ error: 'Invalid notification preference values.' }, { status: 400 });
          }
        }

        // The production profiles schema does not contain timezone, auto-reply,
        // notification-preference, or preferred-language columns. These settings
        // are intentionally saved by the client in per-account local storage;
        // never issue a success-shaped database write to columns that do not exist.
        return NextResponse.json({
          success: true,
          field,
          storage: 'browser',
          message: 'Preferences validated. Device preferences are saved locally.',
        }, {
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        });
      }

      case 'password': {
        // Retire the legacy admin-password mutation path. Password changes must
        // go through the authenticated Supabase Auth client so the current
        // session/password checks and configured Auth policies remain effective.
        return NextResponse.json({
          error: 'Direct Settings API password changes are disabled. Use the secure account password form.',
        }, {
          status: 410,
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        });
      }

      case 'password_change_hold': {
        // This is intentionally only a self-service security hold. It does not
        // change the password; callers set it before asking Supabase Auth to do so.
        const { data: heldRows, error: holdError } = await admin
          .from('profiles')
          .update({
            password_changed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id)
          .select('id');

        if (holdError || !Array.isArray(heldRows) || heldRows.length !== 1) {
          console.error('[SETTINGS] Password-change security hold failed', {
            code: holdError?.code || null,
            rows: Array.isArray(heldRows) ? heldRows.length : null,
          });
          return NextResponse.json({ error: 'Could not set the required account security hold. Password was not changed.' }, { status: 503 });
        }

        return NextResponse.json({
          success: true,
          field,
          message: 'Account security hold recorded.',
        }, {
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        });
      }

      case 'kyc_submission': {
        // Retire this competing KYC write path. Address/document submission,
        // encrypted storage, session registration and verification state are
        // handled by /api/kyc/initiate and the signed Didit webhook only.
        return NextResponse.json({
          error: 'Use the secure identity-verification flow to submit or update KYC information.',
        }, {
          status: 410,
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        });
      }

      default: {
        return NextResponse.json({ error: 'Unsupported settings field.' }, { status: 400 });
      }
    }
  } catch (err: any) {
    console.error('PATCH /api/user/settings unexpected error:', err instanceof Error ? err.name : 'UnknownError');
    return NextResponse.json({ error: 'Could not update account settings.' }, {
      status: 500,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    });
  }
}
