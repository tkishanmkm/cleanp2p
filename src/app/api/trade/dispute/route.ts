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

    const contentLength = req.headers.get('content-length');
    if (contentLength !== null) {
      const parsedLength = Number(contentLength);
      if (!Number.isFinite(parsedLength) || parsedLength < 0 || parsedLength > 64 * 1024) {
        return NextResponse.json({ error: 'Request body exceeds the 64 KB limit.' }, { status: 413 });
      }
    }

    let body: unknown;
    try {
      const rawBody = await req.text();
      if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) {
        return NextResponse.json({ error: 'Request body exceeds the 64 KB limit.' }, { status: 413 });
      }
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Request body must contain valid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }
    const { tradeId, reason, explanation } = body as Record<string, unknown>;
    if (typeof tradeId !== 'string' || tradeId.trim().length === 0 || tradeId.length > 128 ||
        typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 2000) {
      return NextResponse.json({ error: 'Trade ID and dispute reason are required and must be within allowed lengths.' }, { status: 400 });
    }
    if (explanation !== undefined && explanation !== null &&
        (typeof explanation !== 'string' || explanation.length > 10000)) {
      return NextResponse.json({ error: 'Explanation must be text of 10,000 characters or fewer.' }, { status: 400 });
    }
    const combinedReasonLength = reason.trim().length +
      (typeof explanation === 'string' && explanation.trim().length > 0 ? explanation.trim().length + 2 : 0);
    if (combinedReasonLength > 2000) {
      return NextResponse.json({ error: 'Combined dispute reason and explanation must be 2,000 characters or fewer.' }, { status: 400 });
    }

    await openDispute({
      tradeId: tradeId.trim(),
      disputedByUserId: user.id,
      reason: reason.trim(),
      explanation: typeof explanation === 'string' ? explanation.trim() : undefined,
    });

    return NextResponse.json({ success: true, message: 'Dispute opened successfully.' });
  } catch (error: unknown) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error('Failed to open trade dispute:', errorName);
    return NextResponse.json({ error: 'Failed to open dispute. Please try again later.' }, { status: 500 });
  }
}
