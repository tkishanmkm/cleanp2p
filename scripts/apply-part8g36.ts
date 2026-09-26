import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const targetUserId = '37cbd587-9da1-48a1-9659-ed9f49c3e40c';
const mainnetAddress = 'bc1qpm07xt25lpd9x4ev5nl7dp9a75m5gscdwjg2m5';
const testnetAddress = 'tb1qwy3vv3v6qdzykv4f2nhe9lpx7cvkv5tlta2he5';
const targetTxHash = '02f54ba892be830bdbac9dc4b91cde8114e258f1845b649a48fe704102cc1818';

async function main() {
  console.log('=== PART 8G.36 IMPLEMENTATION & VERIFICATION ===\n');

  // 1. Check existing rows
  console.log('--- Step 1: Checking current user_deposit_addresses ---');
  const { data: beforeRows } = await supabase
    .from('user_deposit_addresses')
    .select('*')
    .eq('user_id', targetUserId);
  console.log('Current rows before insert:', beforeRows);

  const existingTestnet = beforeRows?.find(r => r.address === testnetAddress);
  if (!existingTestnet) {
    console.log('\n--- Step 2: Inserting Testnet4 Address row ---');
    const { data: insertedRow, error: insertErr } = await supabase
      .from('user_deposit_addresses')
      .insert({
        user_id: targetUserId,
        network: 'bitcoin',
        chain: 'bitcoin',
        asset_symbol: 'BTC',
        asset_code: 'BTC',
        network_code: 'bitcoin',
        address: testnetAddress,
        derivation_path: "m/84'/1'/0'/0/323"
      })
      .select();

    if (insertErr) {
      console.error('Error inserting Testnet4 address:', insertErr);
      process.exit(1);
    }
    console.log('Inserted row successfully:', insertedRow);
  } else {
    console.log('Testnet4 address row already exists:', existingTestnet);
  }

  // 3. Post-execution verifications
  console.log('\n--- Step 3: Verification Checks ---');

  // A, B, C: Verify user deposit address rows
  const { data: allUserAddrs } = await supabase
    .from('user_deposit_addresses')
    .select('*')
    .eq('user_id', targetUserId);

  console.log('\nA. Mainnet BTC row:');
  const mainnetRow = allUserAddrs?.find(r => r.address === mainnetAddress);
  console.log(mainnetRow);

  console.log('\nB. Testnet4 BTC row:');
  const testnetRow = allUserAddrs?.find(r => r.address === testnetAddress);
  console.log(testnetRow);

  console.log(`\nC. Both addresses exist simultaneously for user: count = ${allUserAddrs?.length} rows`);

  // F & G. Address lookup simulation
  console.log('\nF & G. Step 4 Address Resolution Simulation:');
  
  // Testnet4 lookup simulation
  const { data: testnetLookup } = await supabase
    .from('user_deposit_addresses')
    .select('user_id, address, network, network_code')
    .ilike('address', testnetAddress);
  console.log('F. Testnet4 address lookup match:', testnetLookup);

  // Mainnet lookup simulation
  const { data: mainnetLookup } = await supabase
    .from('user_deposit_addresses')
    .select('user_id, address, network, network_code')
    .ilike('address', mainnetAddress);
  console.log('G. Mainnet address lookup match:', mainnetLookup);

  // H. Verify balances
  console.log('\nH. Balances verification (wallet_assets):');
  const { data: balances } = await supabase
    .from('wallet_assets')
    .select('asset_symbol, balance, locked_balance, reserved_balance, in_escrow, in_withdrawal')
    .eq('user_id', targetUserId);
  console.log(balances);

  // I. Verify pending TX has 0 records
  console.log('\nI. Accounting record check for TX ' + targetTxHash + ':');
  const { data: onchain } = await supabase.from('onchain_deposits').select('*').eq('tx_hash', targetTxHash);
  const { data: deposits } = await supabase.from('deposits').select('*').eq('tx_hash', targetTxHash);
  const { data: ledger } = await supabase.from('ledger_entries').select('*').eq('reference_id', targetTxHash);
  console.log(`- onchain_deposits count: ${onchain?.length || 0}`);
  console.log(`- deposits count: ${deposits?.length || 0}`);
  console.log(`- ledger_entries count: ${ledger?.length || 0}`);
}

main().catch(console.error);
