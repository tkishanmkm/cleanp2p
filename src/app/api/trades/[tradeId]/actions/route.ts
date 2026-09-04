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

    const { action, reason, receiptUrl } = await req.json();

    // Fetch trade record (support by UUID or trade_id)
    let { data: trade } = await supabase
      .from('trades')
      .select('*')
      .or(`id.eq.${tradeId},trade_id.eq.${tradeId}`)
      .maybeSingle();

    const actualTradeId = trade?.id || tradeId;

    if (action === 'MARK_PAID') {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('trades')
        .update({
          status: 'PAID',
          payment_confirmed_at: now,
          paid_at: now,
        })
        .or(`id.eq.${actualTradeId},trade_id.eq.${tradeId}`)
        .eq('buyer_id', user.id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      const announcement = `Buyer marked payment as SENT.${receiptUrl ? ' Payment proof attached.' : ''}`;

      // Post system announcement to trade_messages
      try {
        await supabase.from('trade_messages').insert({
          trade_id: actualTradeId,
          sender_id: user.id,
          content: announcement,
          message: announcement,
          file_url: receiptUrl || null,
          attachment_url: receiptUrl || null,
          is_system_message: true,
          is_system: true,
        });
      } catch (msgErr) {
        console.warn('Failed to insert into trade_messages:', msgErr);
      }

      return NextResponse.json({ success: true, message: 'Payment marked successfully.' });
    }

    if (action === 'RELEASE_ESCROW') {
      let rpcSucceeded = false;
      let rpcResult: any = null;

      try {
        const { data, error } = await supabase.rpc('release_trade_escrow', {
          p_trade_id: actualTradeId,
          p_seller_id: user.id,
        });

        if (!error && data) {
          rpcSucceeded = true;
          rpcResult = data;
        } else if (error && error.code !== 'PGRST202') {
          // If real error occurred (not missing function)
          if (!data?.success && error.message) {
            return NextResponse.json({ error: error.message }, { status: 400 });
          }
        }
      } catch (e) {
        console.warn('release_trade_escrow RPC call failed, falling back:', e);
      }

      if (rpcSucceeded) {
        if (!rpcResult.success) {
          return NextResponse.json({ error: rpcResult.message || 'Failed to release escrow' }, { status: 400 });
        }
        return NextResponse.json({ success: true, message: rpcResult.message || 'Escrow released successfully.' });
      }

      // Fallback: direct update if RPC is missing
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('trades')
        .update({
          status: 'COMPLETED',
          escrow_status: 'released',
          released_at: now,
        })
        .or(`id.eq.${actualTradeId},trade_id.eq.${tradeId}`)
        .eq('seller_id', user.id);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      const releaseMsg = 'Seller released the cryptocurrency from escrow. Trade completed successfully.';
      try {
        await supabase.from('trade_messages').insert({
          trade_id: actualTradeId,
          sender_id: user.id,
          content: releaseMsg,
          message: releaseMsg,
          is_system_message: true,
          is_system: true,
        });
      } catch (mErr) {
        console.warn('Message insert error:', mErr);
      }

      return NextResponse.json({ success: true, message: 'Escrow released successfully.' });
    }

    if (action === 'CANCEL_TRADE') {
      let rpcSucceeded = false;
      let rpcResult: any = null;

      try {
        const { data, error } = await supabase.rpc('cancel_p2p_trade', {
          p_trade_id: actualTradeId,
          p_user_id: user.id,
          p_reason: reason || 'Cancelled by user',
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
        console.warn('cancel_p2p_trade RPC call failed, falling back:', e);
      }

      if (rpcSucceeded) {
        if (!rpcResult.success) {
          return NextResponse.json({ error: rpcResult.message || 'Failed to cancel trade' }, { status: 400 });
        }
        return NextResponse.json({ success: true, message: rpcResult.message || 'Trade cancelled successfully.' });
      }

      // Fallback: direct update if RPC is missing
      const { error: updateError } = await supabase
        .from('trades')
        .update({
          status: 'CANCELLED',
          escrow_status: 'refunded',
          cancellation_reason: reason || 'Cancelled by user',
        })
        .or(`id.eq.${actualTradeId},trade_id.eq.${tradeId}`)
        .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }

      const cancelMsg = `Trade was cancelled: ${reason || 'Cancelled by user'}.`;
      try {
        await supabase.from('trade_messages').insert({
          trade_id: actualTradeId,
          sender_id: user.id,
          content: cancelMsg,
          message: cancelMsg,
          is_system_message: true,
          is_system: true,
        });
      } catch (mErr) {
        console.warn('Message insert error:', mErr);
      }

      return NextResponse.json({ success: true, message: 'Trade cancelled successfully.' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('Error in trade action handler:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
