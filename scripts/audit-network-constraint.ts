import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const targetUserId = '37cbd587-9da1-48a1-9659-ed9f49c3e40c';

async function audit() {
  console.log('=== PART 8G.22 NETWORK AUDIT ===\n');

  // 1. Existing Network Values & Counts in onchain_deposits
  console.log('--- 1. onchain_deposits network counts ---');
  const { data: allOnchain, error: onchainErr } = await supabase
    .from('onchain_deposits')
    .select('network, asset_symbol, status');
  
  if (onchainErr) {
    console.error('Error querying onchain_deposits:', onchainErr);
  } else {
    const counts: Record<string, number> = {};
    for (const row of allOnchain || []) {
      const net = row.network || '(null)';
      counts[net] = (counts[net] || 0) + 1;
    }
    console.log('Network counts in onchain_deposits:', counts);
    console.log('All onchain_deposits rows:', allOnchain);
  }

  // 2. Existing ETH-related records across all users in onchain_deposits
  console.log('\n--- 2. ETH-related records in onchain_deposits ---');
  const { data: ethOnchain } = await supabase
    .from('onchain_deposits')
    .select('network, asset_symbol, tx_hash, amount, status, address, to_address, confirmations, required_confirmations')
    .or('asset_symbol.eq.ETH,network.eq.ETH,network.eq.ethereum,network.eq.ERC20');
  console.log('ETH onchain_deposits:', ethOnchain);

  // 3. User Network Representations across 4 tables for target user
  console.log('\n--- 3. User Network representations for user ' + targetUserId + ' ---');
  
  // A. user_deposit_addresses
  const { data: userAddrs } = await supabase
    .from('user_deposit_addresses')
    .select('network, chain, asset_symbol, asset_code, network_code, address')
    .eq('user_id', targetUserId);
  console.log('A. user_deposit_addresses:', userAddrs);

  // B. onchain_deposits
  const { data: userOnchain } = await supabase
    .from('onchain_deposits')
    .select('network, asset_symbol, amount, status')
    .eq('user_id', targetUserId);
  console.log('B. onchain_deposits:', userOnchain);

  // C. deposits
  const { data: userDeposits } = await supabase
    .from('deposits')
    .select('chain, token_symbol, asset, amount, status')
    .eq('user_id', targetUserId);
  console.log('C. deposits:', userDeposits);

  // D. ledger_entries
  const { data: userLedger } = await supabase
    .from('ledger_entries')
    .select('crypto, asset, chain, amount, type, status')
    .eq('user_id', targetUserId);
  console.log('D. ledger_entries:', userLedger);

  // 4. Test constraint allowed values by attempting test inserts on onchain_deposits (dummy txs with immediate delete)
  console.log('\n--- 4. Testing onchain_deposits.network accepted values ---');
  const testNetworks = ['ETH', 'ethereum', 'ERC20', 'BEP20', 'TRC20', 'BTC', 'LTC', 'tron', 'bitcoin', 'litecoin', 'bsc', 'binance', 'sepolia'];
  
  for (const net of testNetworks) {
    const dummyTx = '0xdummy_test_' + net + '_' + Date.now();
    const { data: insData, error: insErr } = await supabase
      .from('onchain_deposits')
      .insert({
        user_id: targetUserId,
        tx_hash: dummyTx,
        network: net,
        address: '0x86922005c916012046FeeaF4e4DB5365bed99540',
        to_address: '0x86922005c916012046FeeaF4e4DB5365bed99540',
        amount: 0.001,
        asset_symbol: 'ETH',
        confirmations: 1,
        required_confirmations: 12,
        status: 'PENDING',
        output_index: 0
      })
      .select();

    if (insErr) {
      console.log(`Network '${net}': REJECTED (${insErr.message})`);
    } else {
      console.log(`Network '${net}': ACCEPTED`);
      // Cleanup dummy test row immediately
      await supabase.from('onchain_deposits').delete().eq('tx_hash', dummyTx);
    }
  }
}

audit().catch(console.error);
