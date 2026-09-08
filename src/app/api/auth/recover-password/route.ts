import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';
  return createSupabaseClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function POST(req: Request) {
  const GENERIC_RESPONSE = NextResponse.json({
    message: 'If the provided details match our records, a recovery link has been dispatched to your email.'
  });

  try {
    const { usernameOrEmail, securityAnswer } = await req.json();

    if (!usernameOrEmail || !securityAnswer) {
      return GENERIC_RESPONSE;
    }

    const supabaseAdmin = getAdminClient();

    // Find profile by email or username
    const normalizedIdentifier = String(usernameOrEmail).trim().toLowerCase();
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, security_answer_hash')
      .or(`email.eq.${normalizedIdentifier},username.eq.${usernameOrEmail.trim()}`)
      .maybeSingle();

    if (error || !profile || !profile.security_answer_hash || !profile.email) {
      return GENERIC_RESPONSE;
    }

    // Hash user-provided answer and compare
    const inputHash = crypto.createHash('sha256').update(String(securityAnswer).trim().toLowerCase()).digest('hex');

    if (inputHash !== profile.security_answer_hash) {
      return GENERIC_RESPONSE;
    }

    // Trigger password reset email via Supabase Admin
    await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: profile.email,
    });

    return GENERIC_RESPONSE;
  } catch (error) {
    return GENERIC_RESPONSE;
  }
}
