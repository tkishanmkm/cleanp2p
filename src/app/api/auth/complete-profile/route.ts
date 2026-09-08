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

    const { name, dob, country, securityQuestion, securityAnswer, termsAccepted } = await req.json();

    if (!name || !dob || !country || !securityQuestion || !securityAnswer || !termsAccepted) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    // Hash the security answer for protection
    const securityAnswerHash = crypto.createHash('sha256').update(securityAnswer.trim().toLowerCase()).digest('hex');

    const { error } = await supabase
      .from('profiles')
      .update({
        name,
        full_name: name,
        display_name: name,
        date_of_birth: dob,
        dob,
        country,
        security_question: securityQuestion,
        security_answer_hash: securityAnswerHash,
        terms_accepted_at: new Date().toISOString(),
        onboarding_completed: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.user.id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Profile completed successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
  }
}
