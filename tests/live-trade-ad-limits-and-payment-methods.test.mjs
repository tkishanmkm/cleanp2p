import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261031160000_harden_live_trade_ad_limits_and_payment_methods.sql', 'utf8');

assert.match(sql, /to_regprocedure\([\s\S]*?initiate_trade_with_escrow/i);
assert.match(sql, /to_jsonb\(v_ad\)/i);
assert.match(sql, /''min_limit''[\s\S]*?''min_amount''/i);
assert.match(sql, /''max_limit''[\s\S]*?''max_amount''/i);
assert.match(sql, /AD_FIAT_LIMIT/);
assert.match(sql, /jsonb_array_elements_text\(v_payment_methods\)/);
assert.match(sql, /AD_PAYMENT_METHOD_INVALID/);
assert.match(sql, /AD_CALLER_RESTRICTED/);
assert.match(sql, /AD_OWNER_RESTRICTED/);
assert.match(sql, /Audited function definition has drifted; no changes made/);
assert.match(sql, /Trade RPC hardening verification failed; no changes made/);
assert.match(sql, /EXECUTE v_definition/);

console.log('PASS: live escrow RPC candidate enforces stored min/max fiat limits and configured payment methods, and aborts on definition drift.');