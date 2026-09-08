import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { openDispute } from '@/lib/disputes';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tradeId, tradePublicId, reason, paymentMethod, explanation } = await req.json();

    if (!tradeId || !reason) {
      return NextResponse.json({ error: 'Missing dispute parameters (tradeId and reason required)' }, { status: 400 });
    }

    await openDispute({
      tradeId,
      tradePublicId,
      disputedByUserId: user.id,
      reason,
      paymentMethod,
      explanation,
    });

    return NextResponse.json({ success: true, message: 'Dispute opened and instructions dispatched.' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to open dispute' }, { status: 500 });
  }
}
