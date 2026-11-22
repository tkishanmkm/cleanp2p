import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRADE_REF_RE = /^trd_[A-Za-z0-9_-]{4,64}$/;

export async function POST(req: NextRequest, { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) return auth.response!;

    const adminId = auth.adminId || auth.user.id;
    const adminEmail = auth.adminEmail || auth.user.email || null;
    const resolvedParams = typeof (params as any)?.then === 'function' ? await params : params;
    const tradeParam = String(resolvedParams.tradeId || '').trim();
    if (!UUID_RE.test(tradeParam) && !TRADE_REF_RE.test(tradeParam)) {
      return NextResponse.json({ error: 'Invalid trade ID.' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const resolution = String(body?.resolution || '').trim().toUpperCase();
    const notes = typeof body?.notes === 'string' ? body.notes.trim() : '';
    if (!['RELEASE_TO_BUYER', 'REFUND_TO_SELLER'].includes(resolution)) {
      return NextResponse.json({ error: 'Invalid resolution option.' }, { status: 400 });
    }
    if (notes.length > 2000) return NextResponse.json({ error: 'Resolution notes cannot exceed 2,000 characters.' }, { status: 400 });

    const adminClient = getSupabaseAdminClient();
    let tradeQuery = adminClient.from('trades').select('id, seller_id, buyer_id, crypto, crypto_amount, escrow_fee, status, escrow_status');
    tradeQuery = UUID_RE.test(tradeParam) ? tradeQuery.eq('id', tradeParam) : tradeQuery.eq('trade_id', tradeParam);
    const { data: trade, error: tradeError } = await tradeQuery.maybeSingle();
    if (tradeError) return NextResponse.json({ error: 'Trade state is temporarily unavailable.' }, { status: 503 });
    if (!trade) return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });

    const { data: disputes, error: disputeError } = await adminClient
      .from('disputes')
      .select('id, trade_id, status')
      .eq('trade_id', trade.id)
      .in('status', ['open', 'OPEN', 'pending', 'PENDING', 'in_review', 'IN_REVIEW', 'investigating', 'INVESTIGATING'])
      .limit(2);
    if (disputeError) return NextResponse.json({ error: 'Dispute state is temporarily unavailable.' }, { status: 503 });
    if (!disputes || disputes.length !== 1) {
      return NextResponse.json({ error: disputes?.length ? 'Multiple active disputes require manual review.' : 'No active dispute exists for this trade.' }, { status: 409 });
    }

    const winnerId = resolution === 'RELEASE_TO_BUYER' ? trade.buyer_id : trade.seller_id;
    if (!UUID_RE.test(String(winnerId || ''))) return NextResponse.json({ error: 'Trade participant identity is invalid.' }, { status: 409 });
    const rpcResolution = resolution === 'RELEASE_TO_BUYER' ? 'RELEASE' : 'CANCEL';

    const { data: rpcData, error: rpcError } = await adminClient.rpc('resolve_trade_dispute_with_audit', {
      p_dispute_id: disputes[0].id,
      p_resolution: rpcResolution,
      p_winner_id: winnerId,
      p_caller_id: adminId,
      p_admin_email: adminEmail,
      p_notes: notes || null,
    });
    if (rpcError || !rpcData || rpcData.success !== true) {
      console.error('[Admin dispute] Atomic settlement failed:', rpcError || rpcData);
      return NextResponse.json({ error: rpcError?.message || rpcData?.message || 'Dispute settlement failed.' }, { status: 400 });
    }

    const actionDesc = resolution === 'RELEASE_TO_BUYER' ? 'Crypto released to Buyer' : 'Escrow refunded to Seller';
    const resolutionMsg = `Admin moderator resolved dispute: ${actionDesc}. Notes: ${notes || 'No notes provided'}`;
    const { error: messageError } = await adminClient.from('trade_chat_messages').insert({
      trade_id: trade.id,
      sender_id: '00000000-0000-0000-0000-000000000000',
      message: resolutionMsg,
    });
    if (messageError) console.warn('[Admin dispute] System message insert failed after atomic settlement:', messageError);

    return NextResponse.json({ success: true, message: rpcData.message || `Dispute resolved successfully as ${resolution}.`, data: rpcData });
  } catch (err: any) {
    console.error('[Admin dispute] Resolution route failed:', err);
    return NextResponse.json({ error: 'Unable to resolve dispute at this time.' }, { status: 500 });
  }
}