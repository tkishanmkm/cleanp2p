import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

const targetUserId = '37cbd587-9da1-48a1-9659-ed9f49c3e40c';
const targetAddress = '0x86922005c916012046FeeaF4e4DB5365bed99540';
const targetTx = '0xe42aa14a65e5139e3a31f66d1e7f19629e20363105220a4c6a1d6cd5a80c50b9';

async function precheck() {
  console.log('=== STEP 1: READ-ONLY PRECHECK ===');

  // 1. user_deposit_addresses
  console.log('\n--- 1. user_deposit_addresses ---');
  const { data: addrData, error: addrErr } = await supabase
    .from('user_deposit_addresses')
    .select('*')
    .eq('user_id', targetUserId);
  if (addrErr) {
    console.error('Error fetching user_deposit_addresses:', addrErr.message);
  } else {
    console.log(JSON.stringify(addrData, null, 2));
  }

  // 2. wallet_assets
  console.log('\n--- 2. wallet_assets ---');
  const { data: assetData, error: assetErr } = await supabase
    .from('wallet_assets')
    .select('*')
    .eq('user_id', targetUserId);
  if (assetErr) {
    console.error('Error fetching wallet_assets:', assetErr.message);
  } else {
    console.log(JSON.stringify(assetData, null, 2));
  }

  // 3. ledger_entries
  console.log('\n--- 3. ledger_entries ---');
  const { data: ledgerData, error: ledgerErr } = await supabase
    .from('ledger_entries')
    .select('*')
    .eq('user_id', targetUserId);
  if (ledgerErr) {
    console.error('Error fetching ledger_entries:', ledgerErr.message);
  } else {
    console.log(JSON.stringify(ledgerData, null, 2));
  }

  // 4. deposits
  console.log('\n--- 4. deposits ---');
  const { data: depData, error: depErr } = await supabase
    .from('deposits')
    .select('*')
    .eq('user_id', targetUserId);
  if (depErr) {
    console.error('Error fetching deposits:', depErr.message);
  } else {
    console.log(JSON.stringify(depData, null, 2));
  }

  // 5. onchain_deposits
  console.log('\n--- 5. onchain_deposits ---');
  const { data: onchainData, error: onchainErr } = await supabase
    .from('onchain_deposits')
    .select('*')
    .eq('user_id', targetUserId);
  if (onchainErr) {
    console.error('Error fetching onchain_deposits:', onchainErr.message);
  } else {
    console.log(JSON.stringify(onchainData, null, 2));
  }
}

precheck().catch(console.error);
