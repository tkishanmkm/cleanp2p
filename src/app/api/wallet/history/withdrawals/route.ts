import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function mapStatusToDbValues(statusInput: string): string[] {
  const norm = statusInput.trim().toUpperCase();
  switch (norm) {
    case 'PENDING':
    case 'PROCESSING':
    case 'QUEUED':
      return ['pending', 'PENDING', 'processing', 'PROCESSING', 'queued', 'QUEUED'];
    case 'CONFIRMED':
    case 'COMPLETED':
      return ['confirmed', 'CONFIRMED', 'completed', 'COMPLETED', 'processed', 'PROCESSED'];
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
      .from('hot_wallet_withdrawals')
      .select('id, user_id, asset_symbol, amount, gas_fee, to_address, destination_address, tx_hash, status, created_at, updated_at', { count: 'exact' })
      .eq('user_id', user.id);

    if (statusParam) {
      const allowedStatuses = mapStatusToDbValues(statusParam);
      query = query.in('status', allowedStatuses);
    }

    if (assetParam) {
      query = query.ilike('asset_symbol', assetParam.trim());
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching withdrawal history:', error);
      return NextResponse.json({ error: error.message || 'Failed to fetch withdrawal history' }, { status: 500 });
    }

    const totalCount = count ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    const formattedData = (data || []).map((withdrawal) => {
      const amountStr = withdrawal.amount != null ? String(withdrawal.amount) : '0';
      const gasFeeStr = withdrawal.gas_fee != null ? String(withdrawal.gas_fee) : '0';

      return {
        id: withdrawal.id,
        user_id: withdrawal.user_id,
        asset_symbol: (withdrawal.asset_symbol || '').toUpperCase(),
        amount: amountStr,
        gas_fee: gasFeeStr,
        to_address: withdrawal.to_address || withdrawal.destination_address || '',
        tx_hash: withdrawal.tx_hash || 'processing',
        status: (withdrawal.status || 'pending').toLowerCase(),
        created_at: withdrawal.created_at || new Date().toISOString(),
        updated_at: withdrawal.updated_at || null,
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
    console.error('Unexpected error in withdrawal history API:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
