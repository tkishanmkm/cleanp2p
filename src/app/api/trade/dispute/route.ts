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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Request body must contain valid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }
    const { tradeId, tradePublicId, reason, paymentMethod, explanation } = body as Record<string, unknown>;
    if (typeof tradeId !== 'string' || tradeId.trim().length === 0 || tradeId.length > 128 ||
        typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 2000) {
      return NextResponse.json({ error: 'Trade ID and dispute reason are required and must be within allowed lengths.' }, { status: 400 });
    }
    if (tradePublicId !== undefined && tradePublicId !== null &&
        (typeof tradePublicId !== 'string' || tradePublicId.trim().length === 0 || tradePublicId.length > 128)) {
      return NextResponse.json({ error: 'Trade public ID is invalid.' }, { status: 400 });
    }
    if (paymentMethod !== undefined && paymentMethod !== null &&
        (typeof paymentMethod !== 'string' || paymentMethod.length > 100)) {
      return NextResponse.json({ error: 'Payment method must be text of 100 characters or fewer.' }, { status: 400 });
    }
    if (explanation !== undefined && explanation !== null &&
        (typeof explanation !== 'string' || explanation.length > 10000)) {
      return NextResponse.json({ error: 'Explanation must be text of 10,000 characters or fewer.' }, { status: 400 });
    }

    await openDispute({
      tradeId: tradeId.trim(),
      tradePublicId: typeof tradePublicId === 'string' ? tradePublicId.trim() : undefined,
      disputedByUserId: user.id,
      reason: reason.trim(),
      paymentMethod: typeof paymentMethod === 'string' ? paymentMethod.trim() : undefined,
      explanation: typeof explanation === 'string' ? explanation.trim() : undefined,
    });

    return NextResponse.json({ success: true, message: 'Dispute opened and instructions dispatched.' });
  } catch (error: any) {
    console.error('Failed to open trade dispute:', error);
    return NextResponse.json({ error: 'Failed to open dispute. Please try again later.' }, { status: 500 });
  }
}
