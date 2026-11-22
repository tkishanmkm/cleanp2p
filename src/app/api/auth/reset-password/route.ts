import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { hashSecurityAnswer, verifySecurityAnswer } from '@/lib/security-answer';

export const dynamic = 'force-dynamic';

const MAX_RESET_BODY_BYTES = 16 * 1024;

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
      if (totalBytes > MAX_RESET_BODY_BYTES) {
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
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_RESET_BODY_BYTES) {
      return NextResponse.json({ error: 'Password reset request is too large.' }, { status: 413 });
    }

    const rawBody = await readBoundedBody(req);
    if (rawBody === null) {
      return NextResponse.json({ error: 'Password reset request is too large.' }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed password reset request.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid password reset request.' }, { status: 400 });
    }

    const { password, securityQuestion, securityAnswer } = body as Record<string, unknown>;
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return NextResponse.json({ error: 'Password must contain between 8 and 128 characters.' }, { status: 400 });
    }
    if (typeof securityAnswer !== 'string' || securityAnswer.trim().length < 1 || securityAnswer.length > 512) {
      return NextResponse.json({ error: 'Please provide your security answer.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    let authUser: { id: string; email?: string } | null = null;

    const supabaseServer = await createClient();
    const { data: cookieAuth, error: cookieAuthError } = await supabaseServer.auth.getUser();
    if (!cookieAuthError && cookieAuth.user) {
      authUser = { id: cookieAuth.user.id, email: cookieAuth.user.email };
    }

    if (!authUser) {
      const authHeader = req.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        if (token) {
          const { data, error } = await admin.auth.getUser(token);
          if (!error && data.user) authUser = { id: data.user.id, email: data.user.email };
        }
      }
    }

    if (!authUser) {
      return NextResponse.json(
        { error: 'Recovery session missing or expired. Request a new password reset link.' },
        { status: 401 }
      );
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, security_question, security_answer, security_answer_hash')
      .eq('id', authUser.id)
      .maybeSingle();

    if (profileError || !profile) {
      console.error('[RESET PASSWORD] Profile lookup failed', { code: profileError?.code || null });
      return NextResponse.json({ error: 'Unable to verify your account security details.' }, { status: 503 });
    }

    const hasConfiguredAnswer = Boolean(profile.security_answer_hash || profile.security_answer);
    let nextSecurityHash: string | null = null;

    if (hasConfiguredAnswer) {
      const verification = await verifySecurityAnswer(
        securityAnswer,
        profile.security_answer_hash,
        profile.security_answer
      );
      if (!verification.valid) {
        return NextResponse.json({
          error: 'The security answer provided is incorrect. Please verify and try again.',
          question: profile.security_question,
        }, { status: 400 });
      }

      if (verification.needsRehash) {
        nextSecurityHash = await hashSecurityAnswer(securityAnswer);
      }
    } else {
      if (
        typeof securityQuestion !== 'string' ||
        securityQuestion.trim().length < 5 ||
        securityQuestion.trim().length > 200
      ) {
        return NextResponse.json({
          error: 'Set a valid security question to complete your account recovery.',
        }, { status: 400 });
      }
      nextSecurityHash = await hashSecurityAnswer(securityAnswer);
    }

    // Record the withdrawal security hold before changing the Auth password.
    // If Auth rejects the password update, the conservative hold remains rather
    // than allowing a successful password change without its required hold.
    const now = new Date().toISOString();
    const profileUpdate: Record<string, unknown> = {
      password_changed_at: now,
      updated_at: now,
    };
    if (nextSecurityHash) {
      profileUpdate.security_answer_hash = nextSecurityHash;
      profileUpdate.security_answer = null;
      if (!hasConfiguredAnswer && typeof securityQuestion === 'string') {
        profileUpdate.security_question = securityQuestion.trim();
      }
    }

    const { data: updatedRows, error: profileUpdateError } = await admin
      .from('profiles')
      .update(profileUpdate)
      .eq('id', authUser.id)
      .select('id');

    if (profileUpdateError || !Array.isArray(updatedRows) || updatedRows.length !== 1) {
      console.error('[RESET PASSWORD] Could not persist security state and withdrawal hold', {
        code: profileUpdateError?.code || null,
        rows: Array.isArray(updatedRows) ? updatedRows.length : null,
      });
      return NextResponse.json({ error: 'Could not safely complete password recovery. Please retry or contact support.' }, { status: 503 });
    }

    const { error: passwordUpdateError } = await admin.auth.admin.updateUserById(authUser.id, {
      password,
    });

    if (passwordUpdateError) {
      console.error('[RESET PASSWORD] Auth password update failed', {
        code: passwordUpdateError.code || null,
      });
      return NextResponse.json(
        { error: 'Password update failed. Your account remains protected by a temporary withdrawal security hold.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Password updated successfully. You can now log in with your new credentials.',
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[RESET PASSWORD] Request failed', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { error: 'Could not safely complete password recovery. Please retry.' },
      { status: 500 }
    );
  }
}
