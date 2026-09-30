import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = typeof body?.token === 'string' ? body.token.trim() : '';

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Security CAPTCHA verification is required.' },
        { status: 400 }
      );
    }

    const hcaptchaSecret = process.env.HCAPTCHA_SECRET_KEY?.trim();

    if (hcaptchaSecret) {
      const verifyRes = await fetch('https://hcaptcha.com/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: hcaptchaSecret,
          response: token,
        }),
      });

      const verifyData = await verifyRes.json().catch(() => ({}));

      if (!verifyData?.success) {
        console.warn('[Admin Login CAPTCHA] Verification failed:', verifyData);
        return NextResponse.json(
          {
            success: false,
            error: 'Security CAPTCHA validation failed or expired. Please solve the challenge again.',
          },
          { status: 400 }
        );
      }
    } else {
      console.warn('[Admin Login CAPTCHA] Notice: HCAPTCHA_SECRET_KEY is not configured on server.');
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Admin Login CAPTCHA] Server error:', err);
    return NextResponse.json(
      { success: false, error: 'Error validating security challenge. Please try again.' },
      { status: 500 }
    );
  }
}
