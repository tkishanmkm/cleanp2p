import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { getMonitoredAddresses, supabaseAdmin } from '@/jobs/depositIngestion';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET() {
  const targetTxHash = '189079c39ef192fe8d20cf2abef610daea9f33a15f975d1cb9c058ae510a2b7e';
  const targetUserId = '37cbd587-9da1-48a1-9659-ed9f49c3e40c';
  const targetAddress = 'TEHuvkNzdaQbCRPWudV85ux4FRGPXjAyNn';

  const supabase = getSupabaseAdminClient();

  // 1. Check monitored addresses
  const monitored = await getMonitoredAddresses();
  const isAddressMonitored = monitored.tronAddresses.has(targetAddress);

  // 2. Query user_deposit_addresses for target address
  const { data: udaRows, error: udaErr } = await supabase
    .from('user_deposit_addresses')
    .select('*')
    .eq('address', targetAddress);

  // 3. Query deposit_addresses for target address
  const { data: daRows, error: daErr } = await supabase
    .from('deposit_addresses')
    .select('*')
    .eq('address', targetAddress);

  // 4. Query wallets for target user
  const { data: walletRows, error: wErr } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', targetUserId);

  // 5. Direct RPC Test: process_deposit_atomic
  const { data: rpcRes, error: rpcErr } = await supabase.rpc('process_deposit_atomic', {
    p_destination_address: targetAddress,
    p_asset_symbol: 'USDT',
    p_network_code: 'TRC20',
    p_amount: 1000,
    p_tx_hash: targetTxHash,
    p_output_index: 0,
    p_block_number: 62000000,
    p_from_address: 'TFromAddressExample',
    p_token_contract: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    p_confirmations: 20,
    p_provider: 'verification_test',
  });

  // 6. Query resulting database records
  const { data: onchainRecords } = await supabase
    .from('onchain_deposits')
    .select('*')
    .ilike('tx_hash', targetTxHash);

  const { data: depositRecords } = await supabase
    .from('deposits')
    .select('*')
    .ilike('txid', targetTxHash);

  let walletAssetsRecords: any[] = [];
  if (walletRows && walletRows.length > 0) {
    const wIds = walletRows.map((w: any) => w.id);
    const { data: assets } = await supabase
      .from('wallet_assets')
      .select('*')
      .in('wallet_id', wIds);
    walletAssetsRecords = assets || [];
  }

  const { data: ledgerRecords } = await supabase
    .from('ledger_entries')
    .select('*')
    .eq('user_id', targetUserId);

  // 7. Test Idempotency (Call RPC a second time)
  const { data: rpcRes2, error: rpcErr2 } = await supabase.rpc('process_deposit_atomic', {
    p_destination_address: targetAddress,
    p_asset_symbol: 'USDT',
    p_network_code: 'TRC20',
    p_amount: 1000,
    p_tx_hash: targetTxHash,
    p_output_index: 0,
    p_block_number: 62000000,
    p_from_address: 'TFromAddressExample',
    p_token_contract: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    p_confirmations: 20,
    p_provider: 'verification_test_2',
  });

  // Query final wallet assets after second call
  let walletAssetsRecordsPost: any[] = [];
  if (walletRows && walletRows.length > 0) {
    const wIds = walletRows.map((w: any) => w.id);
    const { data: assets } = await supabase
      .from('wallet_assets')
      .select('*')
      .in('wallet_id', wIds);
    walletAssetsRecordsPost = assets || [];
  }

  return NextResponse.json({
    targetTxHash,
    targetUserId,
    targetAddress,
    isAddressMonitored,
    monitoredTronAddresses: Array.from(monitored.tronAddresses),
    udaRows,
    daRows,
    walletRows,
    rpcRes,
    rpcErr,
    rpcRes2,
    rpcErr2,
    onchainRecords,
    depositRecords,
    walletAssetsRecords,
    walletAssetsRecordsPost,
    ledgerRecords,
  });
}
