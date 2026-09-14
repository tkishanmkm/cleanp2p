import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function mapStatusToDbValues(statusInput: string): string[] {
  const norm = statusInput.trim().toUpperCase();
  switch (norm) {
    case 'PENDING':
    case 'PROCESSING':
      return ['pending', 'PENDING', 'processing', 'PROCESSING'];
    case 'CONFIRMED':
    case 'COMPLETED':
      return ['confirmed', 'CONFIRMED', 'completed', 'COMPLETED'];
    case 'FAILED':
    case 'REJECTED':
    case 'CANCELLED':
      return ['failed', 'FAILED', 'rejected', 'REJECTED', 'cancelled', 'CANCELLED'];
    default:
      return [statusInput.toLowerCase(), statusInput.toUpperCase()];
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '20', 10);

    const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
    const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 20 : rawLimit));
    const offset = (page - 1) * limit;

    const statusParam = searchParams.get('status');
    const assetParam = searchParams.get('asset');

    const admin = getSupabaseAdminClient();

    let query = admin
      .from('transfers')
      .select('id, public_id, sender_id, recipient_id, sender_username, recipient_username, amount, fee_amount, crypto, asset_symbol, status, created_at', { count: 'exact' })
      .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`);

    if (statusParam) {
      const allowedStatuses = mapStatusToDbValues(statusParam);
      query = query.in('status', allowedStatuses);
    }

    if (assetParam) {
      const assetClean = assetParam.trim();
      query = query.or(`crypto.ilike.${assetClean},asset_symbol.ilike.${assetClean}`);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching transfer history:', error);
      return NextResponse.json({ error: error.message || 'Failed to fetch transfer history' }, { status: 500 });
    }

    const totalCount = count ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    const formattedData = (data || []).map((transfer) => {
      const isSender = transfer.sender_id === user.id;
      const type: 'SENT' | 'RECEIVED' = isSender ? 'SENT' : 'RECEIVED';
      const amountStr = transfer.amount != null ? String(transfer.amount) : '0';
      const feeStr = transfer.fee_amount != null ? String(transfer.fee_amount) : '0';
      const assetSymbol = (transfer.crypto || transfer.asset_symbol || '').toUpperCase();

      return {
        id: transfer.id,
        public_id: transfer.public_id || null,
        type,
        sender_id: transfer.sender_id,
        recipient_id: transfer.recipient_id,
        sender_username: transfer.sender_username || null,
        recipient_username: transfer.recipient_username || null,
        amount: amountStr,
        fee_amount: feeStr,
        crypto: assetSymbol,
        asset_symbol: assetSymbol,
        status: (transfer.status || 'completed').toLowerCase(),
        created_at: transfer.created_at || new Date().toISOString(),
      };
    });

    return NextResponse.json({
      data: formattedData,
      page,
      limit,
      total_count: totalCount,
      total_pages: totalPages,
    });
  } catch (err: any) {
    console.error('Unexpected error in transfer history API:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
