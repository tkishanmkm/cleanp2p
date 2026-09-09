import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, email, dob, country, securityQuestion, securityAnswer, termsAccepted } = await req.json();

    if (!name || !dob || !securityQuestion || !securityAnswer) {
      return NextResponse.json({ error: 'Name, Date of Birth, and Security Question & Answer are required' }, { status: 400 });
    }

    // Hash the security answer for protection
    const securityAnswerHash = crypto.createHash('sha256').update(securityAnswer.trim().toLowerCase()).digest('hex');

    const updatePayload: Record<string, any> = {
      name: name.trim(),
      full_name: name.trim(),
      display_name: name.trim(),
      date_of_birth: dob,
      dob,
      security_question: securityQuestion,
      security_answer: securityAnswer.trim().toLowerCase(),
      security_answer_hash: securityAnswerHash,
      terms_accepted_at: new Date().toISOString(),
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    };

    if (country) updatePayload.country = country;
    if (email && email.trim()) updatePayload.email = email.trim();

    const { error } = await supabase
      .from('profiles')
      .update(updatePayload)
      .eq('id', session.user.id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Profile completed successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
