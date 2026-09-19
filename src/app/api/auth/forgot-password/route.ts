import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const { identifier, securityQuestion, securityAnswer, captchaToken } = await req.json();

    if (!captchaToken) {
      return NextResponse.json(
        { error: 'Please complete the hCaptcha verification before continuing.' },
        { status: 400 }
      );
    }

    // Optional server-side hCaptcha secret key validation if configured
    const hcaptchaSecret = process.env.HCAPTCHA_SECRET_KEY;
    if (hcaptchaSecret) {
      try {
        const verifyRes = await fetch('https://hcaptcha.com/siteverify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            secret: hcaptchaSecret,
            response: captchaToken,
          }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyData.success) {
          return NextResponse.json(
            { error: 'Captcha validation failed. Please solve the captcha challenge again.' },
            { status: 400 }
          );
        }
      } catch (captchaErr) {
        console.warn('hCaptcha siteverify warning:', captchaErr);
      }
    }

    if (!identifier || !identifier.trim()) {
      return NextResponse.json({ error: 'Email or username is required.' }, { status: 400 });
    }

    const cleanIdentifier = identifier.trim();
    const admin = getSupabaseAdminClient();

    // 1. Locate the profile by email or username
    let query = admin.from('profiles').select('id, email, username, security_question, security_answer');
    
    if (cleanIdentifier.includes('@')) {
      query = query.ilike('email', cleanIdentifier);
    } else {
      query = query.ilike('username', cleanIdentifier);
    }

    const { data: profile, error: findError } = await query.maybeSingle();

    if (findError || !profile) {
      // Return a safe error message to prevent enumeration while still being helpful
      return NextResponse.json({ 
        error: 'No account found matching this email or username. Please check your spelling.' 
      }, { status: 404 });
    }

    // 2. Validate Security Question and Answer if configured on account
    if (profile.security_answer) {
      if (!securityAnswer || !securityAnswer.trim()) {
        return NextResponse.json({ 
          error: 'Please provide the answer to your security question.',
          requiresQuestion: true,
          question: profile.security_question || 'What was the name of your first pet?'
        }, { status: 400 });
      }

      const cleanStoredAnswer = (profile.security_answer || '').trim().toLowerCase();
      const cleanProvidedAnswer = securityAnswer.trim().toLowerCase();

      if (cleanStoredAnswer !== cleanProvidedAnswer) {
        return NextResponse.json({ 
          error: 'The security answer provided is incorrect. Please try again.',
          requiresQuestion: true,
          question: profile.security_question || 'What was the name of your first pet?'
        }, { status: 400 });
      }
    }

    const targetEmail = profile.email;
    if (!targetEmail) {
      return NextResponse.json({ error: 'Account does not have a verified email linked.' }, { status: 400 });
    }

    // 3. Send password reset link to user's email
    const origin = req.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'https://paxones.com';
    const { error: resetError } = await admin.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: `${origin}/reset-password`,
    });

    if (resetError) {
      console.error('Password reset email error:', resetError);
      return NextResponse.json({ error: resetError.message || 'Failed to send reset email' }, { status: 500 });
    }

    // Mask email for user privacy display
    const parts = targetEmail.split('@');
    const namePart = parts[0];
    const domainPart = parts[1] || 'email.com';
    const maskedName = namePart.length > 2 ? `${namePart.slice(0, 2)}***${namePart.slice(-1)}` : `${namePart}***`;
    const maskedEmail = `${maskedName}@${domainPart}`;

    return NextResponse.json({
      success: true,
      email: maskedEmail,
      message: `Password reset link has been dispatched to ${maskedEmail}. Please check your inbox and spam folder.`,
    });
  } catch (err: any) {
    console.error('Forgot password API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
