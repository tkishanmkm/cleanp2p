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
    case 'CREDITED':
      return ['confirmed', 'CONFIRMED', 'completed', 'COMPLETED', 'credited', 'CREDITED'];
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
    const { data: { user } } = await supabase.auth.getUser();

    const { searchParams } = new URL(req.url);
    const requestedUserId = searchParams.get('user_id');
    const targetUserId = user?.id || requestedUserId;

    if (!targetUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);

    const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
    const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 50 : rawLimit));
    const offset = (page - 1) * limit;

    const statusParam = searchParams.get('status');
    const assetParam = searchParams.get('asset');

    const admin = getSupabaseAdminClient();

    // Query both onchain_deposits and deposits tables using admin client
    let onchainQuery = admin
      .from('onchain_deposits')
      .select('*')
      .eq('user_id', targetUserId);

    let depositsQuery = admin
      .from('deposits')
      .select('*')
      .eq('user_id', targetUserId);

    if (statusParam) {
      const allowedStatuses = mapStatusToDbValues(statusParam);
      onchainQuery = onchainQuery.in('status', allowedStatuses);
      depositsQuery = depositsQuery.in('status', allowedStatuses);
    }

    const [onchainRes, legacyDepositsRes] = await Promise.all([
      onchainQuery.order('created_at', { ascending: false }).limit(limit),
      depositsQuery.order('created_at', { ascending: false }).limit(limit)
    ]);

    const records: Array<any> = [];
    const seenHashes = new Set<string>();

    if (onchainRes.data) {
      for (const d of onchainRes.data) {
        const key = d.tx_hash || d.txid || d.id;
        seenHashes.add(key);
        records.push({
          id: d.id,
          user_id: d.user_id,
          tx_hash: d.tx_hash || d.txid || '',
          network: d.network || d.network_code || 'EVM',
          address: d.address || d.to_address || '',
          amount: d.amount != null ? String(d.amount) : '0',
          asset_symbol: (d.asset_symbol || d.asset || 'USDT').toUpperCase(),
          confirmations: d.confirmations ?? 0,
          status: (d.status || 'pending').toLowerCase(),
          created_at: d.created_at || new Date().toISOString(),
          credited_at: d.credited_at || null,
        });
      }
    }

    if (legacyDepositsRes.data) {
      for (const d of legacyDepositsRes.data) {
        const key = d.tx_hash || d.txid || d.id;
        if (!seenHashes.has(key)) {
          seenHashes.add(key);
          records.push({
            id: d.id,
            user_id: d.user_id,
            tx_hash: d.tx_hash || d.txid || '',
            network: d.chain || d.network || 'EVM',
            address: d.to_address || d.address || '',
            amount: d.amount != null ? String(d.amount) : '0',
            asset_symbol: (d.token_symbol || d.asset || 'USDT').toUpperCase(),
            confirmations: 12,
            status: (d.status || 'confirmed').toLowerCase(),
            created_at: d.created_at || new Date().toISOString(),
            credited_at: d.created_at || null,
          });
        }
      }
    }

    let filtered = records;
    if (assetParam) {
      const assetUpper = assetParam.trim().toUpperCase();
      filtered = filtered.filter((r) => r.asset_symbol === assetUpper);
    }

    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const paginated = filtered.slice(offset, offset + limit);

    return NextResponse.json({
      data: paginated,
      page,
      limit,
      total_count: filtered.length,
      total_pages: Math.ceil(filtered.length / limit),
    });
  } catch (err: any) {
    console.error('Unexpected error in deposit history API:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
