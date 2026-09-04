import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    const resolvedParams = typeof (params as any)?.then === 'function' ? await params : params;
    const tradeId = resolvedParams.tradeId;

    if (!tradeId) {
      return NextResponse.json({ error: 'Trade ID is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user || (await supabase.auth.getUser()).data.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { reason } = await req.json();

    // Fetch trade (by UUID or trade_id)
    let { data: trade } = await supabase
      .from('trades')
      .select('*')
      .or(`id.eq.${tradeId},trade_id.eq.${tradeId}`)
      .maybeSingle();

    const actualTradeId = trade?.id || tradeId;

    // Call stored RPC procedure if available
    let rpcSucceeded = false;
    let rpcResult: any = null;

    try {
      const { data, error } = await supabase.rpc('raise_trade_dispute', {
        p_trade_id: actualTradeId,
        p_user_id: user.id,
        p_reason: reason || 'Non-responsive counterparty or payment issue',
      });

      if (!error && data) {
        rpcSucceeded = true;
        rpcResult = data;
      } else if (error && error.code !== 'PGRST202') {
        if (!data?.success && error.message) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
      }
    } catch (e) {
      console.warn('raise_trade_dispute RPC failed, using direct update fallback:', e);
    }

    if (rpcSucceeded) {
      if (!rpcResult.success) {
        return NextResponse.json({ error: rpcResult.message || 'Failed to raise dispute' }, { status: 400 });
      }
      return NextResponse.json({ success: true, message: rpcResult.message || 'Dispute raised successfully.' });
    }

    // Direct fallback: Update trade record
    const now = new Date().toISOString();
    const disputeReason = reason || 'Non-responsive counterparty or payment issue';

    const { error: updateError } = await supabase
      .from('trades')
      .update({
        status: 'DISPUTED',
        disputed_at: now,
        dispute_reason: disputeReason,
        disputed_by: user.id,
      })
      .or(`id.eq.${actualTradeId},trade_id.eq.${tradeId}`);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    // Also record in disputes table if available
    try {
      await supabase.from('disputes').insert([
        {
          trade_id: actualTradeId,
          opened_by: user.id,
          reason: disputeReason,
          explanation: disputeReason,
          status: 'open',
          created_at: now,
        },
      ]);
    } catch (dErr) {
      console.warn('Insert into disputes table skipped:', dErr);
    }

    // Insert system notification in trade_messages
    try {
      await supabase.from('trade_messages').insert({
        trade_id: actualTradeId,
        sender_id: user.id,
        content: `Trade has been marked as DISPUTED. Reason: ${disputeReason}. An admin moderator will inspect transcripts and payment proofs.`,
        message: `Trade has been marked as DISPUTED. Reason: ${disputeReason}. An admin moderator will inspect transcripts and payment proofs.`,
        is_system_message: true,
        is_system: true,
      });
    } catch (mErr) {
      console.warn('System message insert skipped:', mErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Dispute raised successfully. An admin moderator will review this trade.',
    });
  } catch (err: any) {
    console.error('Error in raise dispute route:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
