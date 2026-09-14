import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    const supabase = getSupabaseAdminClient();
    const rawParams = await Promise.resolve(context.params);
    const tradeId = rawParams.tradeId;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);

    // Fetch trade creation time
    let query = supabase.from('trades').select('id, created_at, status');
    if (isUuid) {
      query = query.or(`id.eq.${tradeId},trade_id.eq.${tradeId}`);
    } else {
      query = query.or(`trade_id.eq.${tradeId},id.eq.${tradeId}`);
    }

    const { data: trade, error } = await query.maybeSingle();

    if (error || !trade) {
      return NextResponse.json({ error: 'Trade record not found' }, { status: 404 });
    }

    const completedAt = new Date();
    const createdAt = new Date(trade.created_at || Date.now());
    // Calculate total duration in seconds
    const durationSeconds = Math.max(1, Math.floor((completedAt.getTime() - createdAt.getTime()) / 1000));

    // Update trade record with status, completion time, and frozen duration
    const { error: updateError } = await supabase
      .from('trades')
      .update({
        status: 'COMPLETED',
        completed_at: completedAt.toISOString(),
        released_at: completedAt.toISOString(),
        duration_seconds: durationSeconds,
      })
      .eq('id', trade.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      duration_seconds: durationSeconds,
      completed_at: completedAt,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
