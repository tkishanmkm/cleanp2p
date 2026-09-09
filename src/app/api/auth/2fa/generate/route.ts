import { NextResponse } from 'next/server';
import speakeasy from 'speakeasy';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const email = user.email || 'user';
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `Paxones (${email})`,
      issuer: 'Paxones',
    });

    return NextResponse.json({
      success: true,
      secret: secret.base32,
      otpauth_url: secret.otpauth_url,
    });
  } catch (err: any) {
    console.error('Error generating 2FA secret:', err);
    return NextResponse.json({ error: err.message || 'Failed to generate 2FA secret' }, { status: 500 });
  }
}
