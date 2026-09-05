import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { P2PEscrowService } from '@/lib/p2p/escrowService';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const tradeId = resolvedParams.id;
    const body = await req.json().catch(() => ({}));
    const { action } = body;
    let userId = body.userId || body.user_id;

    if (!userId) {
      try {
        const supabaseSession = await createClient();
        const { data: { user } } = await supabaseSession.auth.getUser();
        if (user?.id) {
          userId = user.id;
        }
      } catch {
        // Continue with any userId supplied
      }
    }

    const supabase = getSupabaseAdminClient();

    if (action === 'MARK_PAID') {
      // Buyer confirms fiat payment was dispatched
      let query = supabase
        .from('p2p_trades')
        .update({ 
          status: 'PAYMENT_MARKED', 
          updated_at: new Date().toISOString() 
        })
        .eq('id', tradeId)
        .in('status', ['ESCROW_LOCKED', 'PENDING_PAYMENT']);

      if (userId) {
        query = query.eq('buyer_id', userId);
      }

      const { error } = await query;

      if (error) {
        throw new Error('Failed to mark payment as sent');
      }

      return NextResponse.json({ success: true, status: 'PAYMENT_MARKED' });
    }

    if (action === 'RELEASE_CRYPTO') {
      // Seller confirms fiat receipt and authorizes hot-wallet release
      const result = await P2PEscrowService.releaseTradeEscrow(tradeId, userId);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Invalid action specified' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
