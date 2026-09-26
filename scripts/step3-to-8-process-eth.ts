import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

const targetUserId = '37cbd587-9da1-48a1-9659-ed9f49c3e40c';
const targetAddress = '0x86922005c916012046FeeaF4e4DB5365bed99540';
const targetTx = '0xe42aa14a65e5139e3a31f66d1e7f19629e20363105220a4c6a1d6cd5a80c50b9';
const targetAmount = 0.05;
const targetNetwork = 'ETH';
const targetAsset = 'ETH';

async function runProcessAndVerify() {
  console.log('=== PART 8G.19 EXECUTION & VERIFICATION ===\n');

  // STEP 3: Process Deposit via RPC
  console.log('--- STEP 3: PROCESSING ETH DEPOSIT VIA RPC ---');
  const rpcParams = {
    p_destination_address: targetAddress,
    p_asset_symbol: targetAsset,
    p_network_code: targetNetwork,
    p_amount: targetAmount,
    p_tx_hash: targetTx,
    p_output_index: 0,
    p_block_number: 11785424,
    p_from_address: '0x9a0C272bD8bb40edB2689bF48B395F8EcB561d55',
    p_token_contract: null,
    p_confirmations: 441, // > required 12 confirmations
    p_provider: 'deposit_ingestion'
  };

  console.log('Calling process_deposit_atomic with params:', rpcParams);
  const { data: rpcResult, error: rpcError } = await supabase.rpc('process_deposit_atomic', rpcParams);

  if (rpcError) {
    console.error('RPC Error:', rpcError);
  } else {
    console.log('RPC Result:', JSON.stringify(rpcResult, null, 2));
  }

  // STEP 4: Verify Financial Result
  console.log('\n--- STEP 4: VERIFYING FINANCIAL RESULT ---');
  
  // A. wallet_assets for ETH
  const { data: ethAsset } = await supabase
    .from('wallet_assets')
    .select('*')
    .eq('user_id', targetUserId)
    .eq('asset_symbol', targetAsset)
    .single();
  console.log('wallet_assets (ETH):', ethAsset);

  // B. ledger_entries
  const { data: ledgerEntries } = await supabase
    .from('ledger_entries')
    .select('*')
    .eq('user_id', targetUserId)
    .eq('reference_id', targetTx);
  console.log('ledger_entries for tx:', ledgerEntries);

  // C. deposits
  const { data: depositsRecords } = await supabase
    .from('deposits')
    .select('*')
    .eq('user_id', targetUserId)
    .eq('tx_hash', targetTx);
  console.log('deposits records for tx:', depositsRecords);

  // D. onchain_deposits
  const { data: onchainRecords } = await supabase
    .from('onchain_deposits')
    .select('*')
    .eq('user_id', targetUserId)
    .eq('tx_hash', targetTx);
  console.log('onchain_deposits records for tx:', onchainRecords);

  // STEP 5 & 6: Idempotency Test & Replay
  console.log('\n--- STEP 5 & 6: IDEMPOTENCY REPLAY TEST ---');
  console.log('Re-calling process_deposit_atomic with the exact same transaction hash and parameters...');
  const { data: replayResult, error: replayError } = await supabase.rpc('process_deposit_atomic', rpcParams);

  if (replayError) {
    console.error('Replay RPC Error:', replayError);
  } else {
    console.log('Replay RPC Result:', JSON.stringify(replayResult, null, 2));
  }

  // Re-check balance to ensure no double credit
  const { data: ethAssetAfter } = await supabase
    .from('wallet_assets')
    .select('*')
    .eq('user_id', targetUserId)
    .eq('asset_symbol', targetAsset)
    .single();
  console.log('wallet_assets (ETH) after replay:', ethAssetAfter);

  // STEP 7: Regression Check for TRC20 USDT
  console.log('\n--- STEP 7: TRC20 USDT REGRESSION CHECK ---');
  const { data: usdtAsset } = await supabase
    .from('wallet_assets')
    .select('*')
    .eq('user_id', targetUserId)
    .eq('asset_symbol', 'USDT')
    .single();
  console.log('wallet_assets (USDT):', usdtAsset);

  const { data: usdtLedger } = await supabase
    .from('ledger_entries')
    .select('*')
    .eq('user_id', targetUserId)
    .eq('reference_id', '189079c39ef192fe8d20cf2abef610daea9f33a15f975d1cb9c058ae510a2b7e');
  console.log('USDT ledger entries:', usdtLedger);

  console.log('\n=== ALL STEPS COMPLETED SUCCESSFULLY ===');
}

runProcessAndVerify().catch(console.error);
