import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

test('pending registration RPC is explicitly non-crediting', () => {
  const sql = read('supabase/migrations/20261024120000_deposit_pending_registration_hardening.sql');
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.register_pending_deposit/i);
  assert.match(sql, /p_confirmations IS DISTINCT FROM 0/i);
  assert.match(sql, /confirmations,required_confirmations,status/i);
  assert.match(sql, /VALUES\(v_user_id,v_hash,v_network,v_address,p_amount,v_asset,0,v_required,'PENDING'/i);
  assert.match(sql, /coalesce\(nullif\(btrim\(coalesce\(p_from_address,''\)\),''\),''\)/i);
  assert.doesNotMatch(sql, /INSERT INTO public\.ledger_entries/i);
  assert.doesNotMatch(sql, /UPDATE public\.wallet_assets/i);
  assert.match(sql, /Never rewrite an existing confirmation count\/status here/i);
  assert.match(sql, /EXISTING_DEPOSIT_IDENTITY_MISMATCH/i);
  assert.match(sql, /EXISTING_ONCHAIN_IDENTITY_MISMATCH/i);
  assert.match(sql, /EXISTING_DEPOSIT_STATE_MISMATCH/i);
  assert.match(sql, /already_processed', true[\s\S]*?'status', 'ALREADY_PROCESSED'/i);
  assert.match(sql, /Never relabel a previously credited output as pending/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.register_pending_deposit/i);
});

test('ERC20 and BEP20 pending registration resolves EVM owners from both registries without double-counting one owner', () => {
  const sql = read('supabase/migrations/20261024120000_deposit_pending_registration_hardening.sql');
  const branch = sql.slice(sql.indexOf("ELSIF v_network IN ('ERC20', 'BEP20') THEN"), sql.indexOf("ELSIF v_network = 'LTC' THEN"));
  assert.match(branch, /FROM public\.wallets/);
  assert.match(branch, /FROM public\.user_deposit_addresses/);
  assert.match(branch, /UNION\s+SELECT user_id AS owner_id/);
  assert.match(branch, /upper\(btrim\(network::text\)\) IN \([\s\S]*v_network[\s\S]*'ETHEREUM'[\s\S]*'BEP20'/);
  assert.match(branch, /SELECT count\(\*\), min\(owner_id::text\)::uuid/);
});

test('all deposit ingress/scanner entry points use pending registration, not the credit RPC', () => {
  const files = [
    'src/jobs/depositIngestion.ts',
    'src/app/api/webhooks/deposit/route.ts',
    'src/app/api/webhooks/alchemy/route.ts',
    'src/app/api/wallet/deposit/route.ts',
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /rpc\('register_pending_deposit'/, file);
    assert.doesNotMatch(source, /rpc\('process_deposit_atomic'/, file);
  }
});

test('confirmation worker does not call credit RPC below independently verified threshold', () => {
  const source = read('src/jobs/confirmationsWorker.ts');
  const guard = source.indexOf('if (currentConfirmations < requiredConfs)');
  const rpc = source.indexOf("rpc('process_deposit_atomic_with_lease'");
  assert.notEqual(guard, -1);
  assert.notEqual(rpc, -1);
  assert.ok(guard < rpc, 'threshold guard must precede credit RPC');
  assert.match(source.slice(guard, rpc), /continue;/);
  assert.match(source.slice(guard, rpc), /credit RPC not called/);
});
