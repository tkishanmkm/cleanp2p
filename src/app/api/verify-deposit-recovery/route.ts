import { NextResponse } from 'next/server';
import { runDepositIngestion } from '@/jobs/depositIngestion';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET() {
  const targetTxHash = '189079c39ef192fe8d20cf2abef610daea9f33a15f975d1cb9c058ae510a2b7e';
  const targetUserId = '37cbd587-9da1-48a1-9659-ed9f49c3e40c';
  const targetDestination = 'TEHuvkNzdaQbCRPWudV85ux4FRGPXjAyNn';
  const targetContract = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';

  const supabase = getSupabaseAdminClient();

  // 1. Run First Ingestion
  const ingestion1 = await runDepositIngestion();

  // Query Database State After First Ingestion
  const { data: onchainRows } = await supabase
    .from('onchain_deposits')
    .select('*')
    .ilike('tx_hash', targetTxHash);

  const { data: depositRows } = await supabase
    .from('deposits')
    .select('*')
    .ilike('txid', targetTxHash);

  const { data: userWallets } = await supabase
    .from('wallets')
    .select('id, user_id, status, address, chain, currency')
    .eq('user_id', targetUserId);

  let walletAssets: any[] = [];
  if (userWallets && userWallets.length > 0) {
    const wIds = userWallets.map((w: any) => w.id);
    const { data: assets } = await supabase
      .from('wallet_assets')
      .select('*')
      .in('wallet_id', wIds);
    walletAssets = assets || [];
  }

  const { data: ledgerEntries } = await supabase
    .from('ledger_entries')
    .select('*')
    .eq('user_id', targetUserId);

  // 2. Run Second Ingestion (Idempotency Check)
  const ingestion2 = await runDepositIngestion();

  // Query Database State After Second Ingestion
  const { data: walletAssetsPost } = await supabase
    .from('wallet_assets')
    .select('*')
    .in('wallet_id', (userWallets || []).map((w: any) => w.id));

  return NextResponse.json({
    targetTxHash,
    targetUserId,
    targetDestination,
    targetContract,
    ingestion1,
    ingestion2,
    db: {
      onchainRows,
      depositRows,
      userWallets,
      walletAssets,
      ledgerEntries,
      walletAssetsPost,
    },
  });
}
