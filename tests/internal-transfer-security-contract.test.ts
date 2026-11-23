import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261123161900_authoritative_internal_transfer_and_escrow_fee_receipts.sql'),
  'utf8',
);
const transferBase = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261002000000_canonical_internal_transfer_and_platform_fee.sql'),
  'utf8',
);
const sellInterlock = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261123155955_enforce_sell_ad_escrow_interlock.sql'),
  'utf8',
);
const route = readFileSync(join(process.cwd(), 'src/app/api/wallet/transfer/route.ts'), 'utf8');

test('internal transfer remains service-role-only and now uses an empty search_path', () => {
  assert.match(transferBase, /GRANT EXECUTE ON FUNCTION public\.execute_internal_transfer[\s\S]*?TO service_role, postgres/i);
  assert.match(migration, /ALTER FUNCTION public\.execute_internal_transfer[\s\S]*?SET search_path = ''/i);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.execute_wallet_transfer[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/i,
  );
});

test('wallet transfer route derives sender from the verified session and validates the database receipt', () => {
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /p_sender_id:\s*user\.id/);
  assert.match(route, /p_idempotency_key:\s*idempotencyKey/);
  assert.match(route, /getPlatformFeeSettings\(\)/);
  assert.match(route, /isValidTransferRpcResponse\(transferData/);
  assert.match(route, /TRANSFER_RPC_ERROR/);
});

test('configured fee is read from app_settings and recipient receives the requested amount', () => {
  assert.match(migration, /platform_fee_percent', '1\.5'/);
  assert.match(migration, /escrow_fee_percent', '1\.5'/);
  assert.match(migration, /min_trade_amount', '10'/);
  assert.match(migration, /FROM public\.app_settings[\s\S]*?WHERE key = ''platform_fee_percent''/i);
  assert.match(migration, /v_recipient_amount := ROUND\(p_gross_amount, 8\)/i);
  assert.match(migration, /v_fee_amount := ROUND\(v_recipient_amount \* v_fee_rate, 8\)/i);
  assert.match(migration, /v_total_deduction := v_recipient_amount \+ v_fee_amount/i);
});

test('transfer fee is persisted as platform revenue and paired with the transfer receipt', () => {
  assert.match(migration, /INSERT INTO public\.platform_ledger_entries/i);
  assert.match(migration, /'transfer_fee_collected'/i);
  assert.match(migration, /'fee_transfer_' \|\| v_transfer_id::TEXT/i);
  assert.match(migration, /''fee_rate'', v_fee_rate/i);
  assert.match(migration, /''fee_rate'', v_existing_fee_rate/i);
  assert.match(migration, /''total_deduction'', v_total_deduction/i);
  assert.match(migration, /''idempotent_replay'', FALSE/i);
});

test('escrow fee uses app_settings while prior trusted-actor and SELL safeguards are retained', () => {
  assert.match(migration, /trusted-actor identity check; preserve those controls unchanged/i);
  assert.match(migration, /v_escrow_fee := ROUND\(v_crypto_amount \* v_escrow_fee_rate, 8\)/i);
  assert.match(sellInterlock, /SELL_AD_INVENTORY_RESERVATION_UNVERIFIED/i);
  assert.match(sellInterlock, /IF v_ad_type IS DISTINCT FROM ''BUY''/i);
});
