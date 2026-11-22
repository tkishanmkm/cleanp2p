import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const QUERY_BATCH_SIZE = 1000;
const HISTORY_FETCH_CAP = 5000;

function mapStatusToDbValues(statusInput: string): string[] {
  const normalized = statusInput.trim().toUpperCase();
  switch (normalized) {
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
      return [normalized.toLowerCase(), normalized];
  }
}

function depositIdentityKey(row: Record<string, unknown>, mirror: 'onchain' | 'legacy'): string {
  const txHash = String(row.tx_hash || row.txid || '').trim().toLowerCase();
  if (!txHash) return mirror + ':' + String(row.id || '');
  const network = String(row.network || row.network_code || row.chain || '').trim().toUpperCase();
  const outputIndex = Number.isSafeInteger(Number(row.output_index)) ? Number(row.output_index) : 0;
  return [network, txHash, String(outputIndex)].join(':');
}

async function fetchDepositRows(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  table: 'onchain_deposits' | 'deposits',
  userId: string,
  statusValues: string[] | null,
): Promise<{ rows: any[]; rowCount: number | null; truncated: boolean }> {
  const rows: any[] = [];
  let rowCount: number | null = null;
  let offset = 0;

  while (offset < HISTORY_FETCH_CAP) {
    let query = admin
      .from(table)
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + QUERY_BATCH_SIZE - 1);

    if (statusValues) query = query.in('status', statusValues);

    const { data, count, error } = await query;
    if (error) throw new Error('Unable to load ' + table + ' history (' + error.code + ').');
    if (rowCount === null && typeof count === 'number') rowCount = count;

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < QUERY_BATCH_SIZE) break;
    offset += batch.length;
    if (rowCount !== null && rows.length >= rowCount) break;
  }

  return {
    rows,
    rowCount,
    truncated: rowCount !== null && rows.length < rowCount,
  };
}

export async function GET(req: NextRequest) {
  try {
    const sessionClient = await createClient();
    const { data: { user }, error: authError } = await sessionClient.auth.getUser();

    // Never accept user_id as an authentication substitute. The service-role
    // client below is used only for the user bound by the verified cookie session.
    if (authError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const rawPage = Number.parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = Number.parseInt(searchParams.get('limit') || '50', 10);
    const page = Math.max(1, Math.min(50, Number.isFinite(rawPage) ? rawPage : 1));
    const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 50));
    const offset = (page - 1) * limit;

    const statusParam = searchParams.get('status');
    const assetParam = searchParams.get('asset')?.trim().toUpperCase() || null;
    if (assetParam && !/^[A-Z0-9]{2,12}$/.test(assetParam)) {
      return NextResponse.json({ error: 'Invalid asset filter.' }, { status: 400 });
    }
    const statusValues = statusParam ? mapStatusToDbValues(statusParam) : null;

    const admin = getSupabaseAdminClient();
    const [onchainResult, legacyResult] = await Promise.all([
      fetchDepositRows(admin, 'onchain_deposits', user.id, statusValues),
      fetchDepositRows(admin, 'deposits', user.id, statusValues),
    ]);

    // The two tables mirror the same chain output. Prefer the canonical
    // onchain_deposits row and merge the legacy deposits row only when the
    // network + transaction hash + output/log index is not already present.
    const records: any[] = [];
    const seen = new Set<string>();

    for (const row of onchainResult.rows) {
      const key = depositIdentityKey(row, 'onchain');
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({
        id: row.id,
        user_id: row.user_id,
        tx_hash: row.tx_hash || row.txid || '',
        network: row.network || row.network_code || 'EVM',
        address: row.address || row.to_address || '',
        amount: row.amount != null ? String(row.amount) : '0',
        asset_symbol: String(row.asset_symbol || row.asset_code || row.asset || 'USDT').toUpperCase(),
        output_index: row.output_index ?? 0,
        confirmations: row.confirmations ?? null,
        required_confirmations: row.required_confirmations ?? null,
        status: String(row.status || 'pending').toLowerCase(),
        created_at: row.created_at || new Date().toISOString(),
        credited_at: row.credited_at || null,
      });
    }

    for (const row of legacyResult.rows) {
      const key = depositIdentityKey(row, 'legacy');
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({
        id: row.id,
        user_id: row.user_id,
        tx_hash: row.tx_hash || row.txid || '',
        network: row.chain || row.network || row.network_code || 'EVM',
        address: row.to_address || row.address || '',
        amount: row.amount != null ? String(row.amount) : '0',
        asset_symbol: String(row.token_symbol || row.asset_code || row.asset || 'USDT').toUpperCase(),
        output_index: row.output_index ?? 0,
        // The legacy table does not carry independently verified confirmation
        // counts. Never fabricate a fixed confirmation count for old rows.
        confirmations: null,
        required_confirmations: null,
        status: String(row.status || 'confirmed').toLowerCase(),
        created_at: row.created_at || new Date().toISOString(),
        credited_at: row.credited_at || null,
      });
    }

    let filtered = records;
    if (assetParam) filtered = filtered.filter((record) => record.asset_symbol === assetParam);
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const paginated = filtered.slice(offset, offset + limit);
    const truncated = onchainResult.truncated || legacyResult.truncated;

    return NextResponse.json(
      {
        data: paginated,
        page,
        limit,
        total_count: filtered.length,
        total_pages: Math.ceil(filtered.length / limit),
        truncated,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: unknown) {
    console.error('[DEPOSIT_HISTORY] Read failed:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'Deposit history could not be loaded.' }, { status: 503 });
  }
}
