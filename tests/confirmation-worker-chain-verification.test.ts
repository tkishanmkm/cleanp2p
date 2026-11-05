import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const worker = readFileSync('src/jobs/confirmationsWorker.ts', 'utf8');

test('confirmation worker never uses fabricated UTXO or TRON confirmation counts', () => {
  assert.doesNotMatch(worker, /statusData\.confirmed\s*\?\s*[26]\s*:\s*0/);
  assert.doesNotMatch(worker, /return \{ confirmations: 19/);
  assert.match(worker, /verifyUtxoDepositOutput\(/);
  assert.match(worker, /Math\.abs\(verified\.amount - expected\)/);
  assert.match(worker, /const confs = currentBlock - data\.blockNumber \+ 1/);
});

test('unavailable chain verification prevents the credit RPC from running', () => {
  const guard = worker.indexOf('if (!onChainData)');
  const rpc = worker.indexOf("supabaseAdmin.rpc('process_deposit_atomic_with_lease'");
  assert.notEqual(guard, -1);
  assert.notEqual(rpc, -1);
  assert.ok(guard < rpc, 'verification guard must appear before the credit RPC');
  assert.match(worker.slice(guard, rpc), /no credit attempted[\s\S]*?continue;/);
  assert.match(worker, /previousConfirmations: prevConfs,[\s\S]*?newConfirmations: 0/);
});

test('EVM credit path requires exact recipient, token contract, amount and log index verification', () => {
  assert.match(worker, /verifyEvmDepositEvidence\(/);
  assert.match(worker, /provider\.getTransaction\(txHash\)/);
  assert.match(worker, /data\.id\.toLowerCase\(\) !== txHash\.toLowerCase\(\)/);
  assert.match(worker, /data\.receipt\?\.result !== 'SUCCESS'/);
  assert.match(worker, /verifyTronTransferEvent\(/);
  assert.match(worker, /events\?only_confirmed=true/);
});

test('worker refuses to use anon or placeholder credentials for financial writes', () => {
  assert.match(worker, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(worker, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(worker, /placeholder-key|placeholder\.supabase\.co/);
  assert.match(worker, /if \(!supabaseAdmin\)[\s\S]*?refusing to run financial writes/);
});

test('UTXO deposits require a recorded output index rather than guessing output zero', () => {
  assert.match(worker, /deposit\.output_index \?\? deposit\.log_index \?\? -1/);
  assert.match(worker, /Missing or invalid persisted transaction output\/event index; no credit attempted/);
  assert.match(worker, /Number\.isSafeInteger\(outputIndex\) \|\| outputIndex < 0/);
  assert.match(worker, /const outputIndex = normNet === 'ETH' && assetSymbol === 'ETH'[\s\S]*?: \(deposit\.output_index \?\? deposit\.log_index \?\? -1\)/);
  const indexGuard = worker.indexOf('if (!Number.isSafeInteger(outputIndex) || outputIndex < 0)');
  const chainVerification = worker.indexOf('fetchOnChainConfirmations(' , worker.indexOf('async function executeConfirmationsWorker'));
  const creditRpc = worker.indexOf("supabaseAdmin.rpc('process_deposit_atomic_with_lease'");
  assert.ok(indexGuard >= 0 && chainVerification > indexGuard && creditRpc > chainVerification);
});


test('confirmation worker enforces a fixed per-network confirmation policy', () => {
  const expected = { BTC: 3, LTC: 12, ETH: 12, ERC20: 12, BEP20: 15, TRC20: 19 };
  for (const [network, count] of Object.entries(expected)) {
    assert.match(worker, new RegExp(`${network}: ${count},`));
  }
  assert.match(worker, /getRequiredDepositConfirmations\(normNet\)/);
});

test('missing, unsupported, or mismatched stored thresholds fail closed before the credit RPC', () => {
  const guard = worker.indexOf('if (requiredConfs === null || deposit.required_confirmations !== requiredConfs)');
  const rpc = worker.indexOf("supabaseAdmin.rpc('process_deposit_atomic_with_lease'");
  assert.ok(guard >= 0 && rpc >= 0 && guard < rpc);
  assert.match(worker.slice(guard, rpc), /Unsupported deposit network; refusing credit/);
  assert.match(worker.slice(guard, rpc), /Stored confirmation threshold mismatch/);
  assert.match(worker.slice(guard, rpc), /continue;/);
});
