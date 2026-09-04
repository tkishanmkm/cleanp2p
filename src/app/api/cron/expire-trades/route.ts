import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Validate Cron Authorization Header to prevent public unauthorized execution
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET_KEY || process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized Cron Invocation' }, { status: 401 });
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();

    // 1. Attempt database RPC procedure if installed
    let rpcSuccess = false;
    let expiredTrades: any[] = [];

    try {
      const { data, error } = await supabaseAdmin.rpc('expire_unpaid_p2p_trades', {
        p_expiry_minutes: 15,
      });

      if (!error) {
        rpcSuccess = true;
        expiredTrades = Array.isArray(data) ? data : (data ? [data] : []);
      } else {
        console.warn('expire_unpaid_p2p_trades RPC not found or failed, executing resilient fallback:', error.message);
      }
    } catch (rpcErr) {
      console.warn('RPC execution exception, using fallback:', rpcErr);
    }

    // 2. Resilient fallback query: find PENDING trades created > 15 minutes ago with no payment
    if (!rpcSuccess) {
      const cutoffTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();

      const { data: staleTrades, error: fetchErr } = await supabaseAdmin
        .from('trades')
        .select('*')
        .eq('status', 'PENDING')
        .lt('created_at', cutoffTime);

      if (fetchErr) {
        return NextResponse.json({ success: false, error: fetchErr.message }, { status: 500 });
      }

      if (staleTrades && staleTrades.length > 0) {
        for (const trade of staleTrades) {
          // Cancel trade and release locked escrow back to seller
          const { error: updateErr } = await supabaseAdmin
            .from('trades')
            .update({
              status: 'CANCELLED',
              escrow_status: 'refunded',
              updated_at: new Date().toISOString(),
            })
            .eq('id', trade.id);

          if (!updateErr) {
            expiredTrades.push({ id: trade.id, trade_id: trade.trade_id, status: 'CANCELLED' });

            // Post system log in trade chat
            try {
              const cancelMsg = 'Trade automatically cancelled due to 15-minute payment expiration window closing. Escrow returned to seller.';
              await supabaseAdmin.from('trade_messages').insert({
                trade_id: trade.id,
                sender_id: trade.seller_id,
                content: cancelMsg,
                message: cancelMsg,
                is_system_message: true,
                is_system: true,
              });
            } catch (msgErr) {
              console.warn('Could not post expiration system message:', msgErr);
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed_count: expiredTrades.length,
      expired_trades: expiredTrades,
    });
  } catch (err: any) {
    console.error('Error in expire-trades cron:', err);
    return NextResponse.json({ success: false, error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
