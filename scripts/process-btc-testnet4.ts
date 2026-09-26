import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const targetUserId = '37cbd587-9da1-48a1-9659-ed9f49c3e40c';
const targetAddress = 'tb1qwy3vv3v6qdzykv4f2nhe9lpx7cvkv5tlta2he5';
const targetTxHash = '02f54ba892be830bdbac9dc4b91cde8114e258f1845b649a48fe704102cc1818';

function getBtcMempoolApi(): string {
  if (process.env.BTC_MEMPOOL_API && process.env.BTC_MEMPOOL_API.trim() !== '') {
    return process.env.BTC_MEMPOOL_API.trim();
  }
  const net = (process.env.BTC_NETWORK || 'mainnet').toLowerCase().trim();
  if (net === 'testnet4') return 'https://mempool.space/testnet4/api';
  return 'https://mempool.space/api';
}

async function main() {
  console.log('=== PART 8G.33 — BTC TESTNET4 DEPOSIT PROCESSING ===\n');

  // 1. Verify mempool endpoint
  const btcApiBase = getBtcMempoolApi();
  console.log('1. BTC Mempool API Endpoint:', btcApiBase);

  // 2. Query transaction from mempool API
  console.log(`\n2. Querying ${btcApiBase}/tx/${targetTxHash}...`);
  const txRes = await fetch(`${btcApiBase}/tx/${targetTxHash}`);
  if (!txRes.ok) {
    throw new Error(`Failed to fetch tx from mempool: HTTP ${txRes.status} ${txRes.statusText}`);
  }
  const tx = await txRes.json();
  console.log('Tx status:', tx.status);

  // 3. Find matching vout for target address
  let outputAmountSat = 0;
  let voutIndex = 0;
  let matchedOutput: any = null;

  for (let i = 0; i < (tx.vout || []).length; i++) {
    const out = tx.vout[i];
    if (out.scriptpubkey_address === targetAddress) {
      outputAmountSat += out.value || 0;
      voutIndex = i;
      matchedOutput = out;
      console.log(`Found matching output index #${i}: ${out.value} satoshis for ${targetAddress}`);
    }
  }

  if (!matchedOutput) {
    throw new Error(`No output found in tx ${targetTxHash} for destination address ${targetAddress}`);
  }

  const btcAmount = outputAmountSat / 100_000_000;
  const isConfirmed = tx.status?.confirmed === true;
  const blockHeight = tx.status?.block_height;

  let confirmations = 0;
  if (isConfirmed && blockHeight) {
    const tipRes = await fetch(`${btcApiBase}/blocks/tip/height`);
    if (tipRes.ok) {
      const tipHeight = parseInt(await tipRes.text(), 10);
      confirmations = Math.max(1, tipHeight - blockHeight + 1);
      console.log(`Tip height: ${tipHeight}, Tx block: ${blockHeight}, Calculated Confirmations: ${confirmations}`);
    } else {
      confirmations = 2;
    }
  } else {
    confirmations = 0;
  }

  console.log('\n3. Verified Transaction Details:', {
    txid: tx.txid,
    voutIndex,
    outputAmountSat,
    btcAmount,
    isConfirmed,
    blockHeight,
    confirmations
  });

  // 4. Call process_deposit_atomic
  const rpcParams = {
    p_destination_address: targetAddress,
    p_asset_symbol: 'BTC',
    p_network_code: 'BTC',
    p_amount: btcAmount,
    p_tx_hash: tx.txid,
    p_output_index: voutIndex,
    p_block_number: blockHeight || null,
    p_from_address: null,
    p_token_contract: null,
    p_confirmations: confirmations,
    p_provider: 'deposit_ingestion'
  };

  console.log('\n4. Executing public.process_deposit_atomic with params:');
  console.log(JSON.stringify(rpcParams, null, 2));

  const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('process_deposit_atomic', rpcParams);

  console.log('\n5. RPC Result:');
  console.log(JSON.stringify({ data: rpcResult, error: rpcError }, null, 2));

  // 5. Query live database tables
  console.log('\n6. Database Verification:');

  // A. wallet_assets
  const { data: walletAssets, error: waErr } = await supabaseAdmin
    .from('wallet_assets')
    .select('*')
    .eq('user_id', targetUserId);
  console.log('A. wallet_assets:', walletAssets);

  // B. onchain_deposits
  const { data: onchainDeposits, error: ocErr } = await supabaseAdmin
    .from('onchain_deposits')
    .select('*')
    .eq('tx_hash', tx.txid);
  console.log('B. onchain_deposits:', onchainDeposits);

  // C. deposits
  const { data: deposits, error: depErr } = await supabaseAdmin
    .from('deposits')
    .select('*')
    .eq('tx_hash', tx.txid);
  console.log('C. deposits:', deposits);

  // D. ledger_entries
  const { data: ledgerEntries, error: ledErr } = await supabaseAdmin
    .from('ledger_entries')
    .select('*')
    .eq('reference_id', tx.txid);
  console.log('D. ledger_entries:', ledgerEntries);
}

main().catch(console.error);
