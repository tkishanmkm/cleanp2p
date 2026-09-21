import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { password, securityQuestion, securityAnswer } = body;

    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long.' },
        { status: 400 }
      );
    }

    if (!securityAnswer || !securityAnswer.trim()) {
      return NextResponse.json(
        { error: 'Please provide the answer to your security question.' },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdminClient();
    let authUser: any = null;

    // 1. Try resolving user from request auth cookies
    try {
      const supabaseServer = await createClient();
      const { data: { user } } = await supabaseServer.auth.getUser();
      if (user) {
        authUser = user;
      }
    } catch (e) {
      console.warn('[RESET_PASSWORD] Cookie auth lookup failed, checking authorization header');
    }

    // 2. If cookie user is not present, check Authorization Bearer header
    if (!authUser) {
      const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        if (token) {
          const { data: { user }, error: tokenErr } = await admin.auth.getUser(token);
          if (!tokenErr && user) {
            authUser = user;
          }
        }
      }
    }

    if (!authUser) {
      return NextResponse.json(
        { error: 'Auth session missing or recovery link expired. Please request a new password recovery link.' },
        { status: 401 }
      );
    }

    // 3. Verify security question and answer against profile in database
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('id, email, username, security_question, security_answer, security_answer_hash')
      .eq('id', authUser.id)
      .maybeSingle();

    if (profileErr) {
      console.error('[RESET_PASSWORD] Profile query error:', profileErr);
    }

    const cleanInputAnswer = securityAnswer.trim().toLowerCase();
    const sha256Input = crypto.createHash('sha256').update(cleanInputAnswer).digest('hex');
    const base64Input = Buffer.from(cleanInputAnswer).toString('base64');

    if (profile && (profile.security_answer || profile.security_answer_hash)) {
      const cleanStoredAnswer = (profile.security_answer || '').trim().toLowerCase();
      const storedHash = (profile.security_answer_hash || '').trim();

      const isMatch =
        (cleanStoredAnswer && cleanStoredAnswer === cleanInputAnswer) ||
        (storedHash && (storedHash === sha256Input || storedHash === base64Input));

      if (!isMatch) {
        return NextResponse.json(
          {
            error: 'The security answer provided is incorrect. Please verify and try again.',
            question: profile.security_question,
          },
          { status: 400 }
        );
      }
    } else {
      // If profile does not have security question configured, save the chosen security question
      if (profile && securityQuestion) {
        await admin
          .from('profiles')
          .update({
            security_question: securityQuestion.trim(),
            security_answer: cleanInputAnswer,
            security_answer_hash: sha256Input,
            updated_at: new Date().toISOString(),
          })
          .eq('id', authUser.id);
      }
    }

    // 4. Update the user password in Supabase Auth via Admin client
    const { error: updateErr } = await admin.auth.admin.updateUserById(authUser.id, {
      password: password,
    });

    if (updateErr) {
      console.error('[RESET_PASSWORD] Password update error:', updateErr);
      return NextResponse.json(
        { error: updateErr.message || 'Failed to update password.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Password updated successfully. You can now log in with your new credentials.',
    });
  } catch (err: any) {
    console.error('[RESET_PASSWORD] Unexpected error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error while resetting password.' },
      { status: 500 }
    );
  }
}
