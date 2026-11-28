import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migration = readFileSync(
  'supabase/migrations/20261019180000_add_idempotent_withdrawal_wrapper.sql',
  'utf8'
);
const replayLookupMigration = readFileSync(
  'supabase/migrations/20261020200000_withdrawal_idempotency_replay_lookup.sql',
  'utf8'
);
const canonicalWithdrawalMigration = readFileSync(
  'supabase/migrations/20261020120000_fail_closed_withdrawal_usd_valuation.sql',
  'utf8'
);
const settlementMigration = readFileSync(
  'supabase/migrations/20260928020000_withdrawal_hardened_rpcs.sql',
  'utf8'
);
const atomicBroadcastMigration = readFileSync(
  'supabase/migrations/20261102212707_durable_withdrawal_broadcasts.sql',
  'utf8'
);
const restrictQueueClaimMigration = readFileSync(
  'supabase/migrations/20261020170000_restrict_withdrawal_queue_claim_rpc.sql',
  'utf8'
);
const withdrawalSchemaParityMigration = readFileSync(
  'supabase/migrations/20260928000000_platform_ledger_entries.sql',
  'utf8'
);
const service = readFileSync('src/lib/services/withdrawalService.ts', 'utf8');
const fees = readFileSync('src/lib/fees.ts', 'utf8');
const legacyWithdrawalRoute = readFileSync('src/app/api/withdraw/route.ts', 'utf8');
const canonicalWithdrawalRoute = readFileSync('src/app/api/withdrawals/request/route.ts', 'utf8');
const walletWithdrawalRoute = readFileSync('src/app/api/wallet/withdraw/route.ts', 'utf8');
const client = readFileSync('src/context/wallet-context.tsx', 'utf8');
const retryStore = readFileSync('src/lib/withdrawal-idempotency-store.ts', 'utf8');
const processor = readFileSync('src/lib/withdrawal-processor.ts', 'utf8');
const workerRoute = readFileSync('src/app/api/workers/withdraw/route.ts', 'utf8');
const currentWithdrawalContract = readFileSync(
  'supabase/migrations/20261102195301_repair_withdrawal_end_to_end_contract.sql',
  'utf8'
);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.request_withdrawal_idempotent/i);
assert.match(migration, /p_idempotency_key TEXT/i);
assert.match(migration, /length\(p_idempotency_key\) < 8[\s\S]*length\(p_idempotency_key\) > 128/i);
assert.match(migration, /PERFORM 1 FROM public\.profiles WHERE id = p_user_id FOR UPDATE/i,
  'same-user withdrawal creation must be serialized');
assert.match(migration, /FROM public\.withdrawal_idempotency_keys\s+WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key\s+FOR UPDATE/i,
  'retries must lookup the exact user-scoped key in the dedicated table');
assert.match(migration, /IDEMPOTENCY_KEY_CONFLICT/i,
  'reusing a key with different request details must be rejected');
assert.match(migration, /Fingerprint only the user's withdrawal intent/i);
assert.match(migration, /p_amount::TEXT,[\s\S]*?UPPER\(TRIM\(COALESCE\(p_asset, 'USDT'\)\)\)/i,
  'fingerprint must include amount and asset intent');
assert.doesNotMatch(migration, /v_fingerprint := md5\(concat_ws\('\|',[\s\S]*?COALESCE\(p_fee, 0\)::TEXT[\s\S]*?COALESCE\(p_usd_equivalent, 0\)::TEXT/i,
  'server-derived fee and USD valuation must not make an identical retry conflict');
assert.match(migration, /INSERT INTO public\.withdrawal_idempotency_keys\s*\([\s\S]*?request_fingerprint, withdrawal_id, response[\s\S]*?v_fingerprint, v_withdrawal_id, v_result/i,
  'the scoped key, request fingerprint, withdrawal ID, and response must be persisted atomically outside the canonical withdrawal schema');
assert.doesNotMatch(migration, /UPDATE public\.withdrawals\s+SET idempotency_key/i,
  'do not assume the canonical withdrawals table has an idempotency_key column');
assert.match(migration, /REVOKE EXECUTE[\s\S]*FROM PUBLIC, anon, authenticated/i);
assert.match(migration, /GRANT EXECUTE[\s\S]*TO service_role, postgres/i);

assert.ok(replayLookupMigration.includes('CREATE OR REPLACE FUNCTION public.lookup_withdrawal_idempotency_replay'));
assert.ok(replayLookupMigration.includes('STABLE'));
assert.ok(replayLookupMigration.includes('SECURITY DEFINER'));
assert.ok(replayLookupMigration.includes('IDEMPOTENCY_KEY_CONFLICT'));
assert.ok(replayLookupMigration.includes("RETURN jsonb_build_object('found', FALSE)"));
assert.ok(replayLookupMigration.includes("RETURN jsonb_build_object('found', TRUE, 'response', v_existing.response)"));
assert.doesNotMatch(replayLookupMigration, /INSERT INTO public\.(withdrawals|onchain_withdrawals|ledger_entries)|UPDATE public\.(withdrawals|onchain_withdrawals|wallet_assets|ledger_entries)/i,
  'replay lookup must never write financial state');
assert.ok(replayLookupMigration.includes('FROM PUBLIC, anon, authenticated'));
assert.ok(replayLookupMigration.includes('TO service_role, postgres'));
assert.match(replayLookupMigration, /v_fingerprint := md5\(concat_ws\('\|',[\s\S]*?UPPER\(TRIM\(COALESCE\(p_network, ''\)\)\),[\s\S]*?TRIM\(COALESCE\(p_to_address, ''\)\),[\s\S]*?p_amount::TEXT,[\s\S]*?UPPER\(TRIM\(COALESCE\(p_asset, 'USDT'\)\)\)/i,
  'replay lookup fingerprint must match the atomic reservation wrapper intent fields');
assert.match(canonicalWithdrawalMigration, /RETURN jsonb_build_object\([\s\S]*?'success', true,[\s\S]*?'withdrawal_id', v_withdrawal_id,[\s\S]*?'total_debited', v_total_deduct/i,
  'canonical withdrawal RPC must return the fields required by replay response validation');
assert.match(migration, /v_result := public\.request_withdrawal\([\s\S]*?p_usd_equivalent := p_usd_equivalent/i,
  'idempotency wrapper must call the latest canonical valuation-aware withdrawal RPC');

// All active withdrawal request routes must enforce the same request-body safety boundary.
for (const [routeName, routeSource] of [
  ['legacy withdrawal route', legacyWithdrawalRoute],
  ['canonical withdrawal route', canonicalWithdrawalRoute],
  ['wallet withdrawal route', walletWithdrawalRoute],
] as const) {
  assert.match(routeSource, /MAX_WITHDRAWAL_REQUEST_BYTES\s*=\s*4\s*\*\s*1024/i, `${routeName} must cap request bodies at 4 KiB`);
  assert.match(routeSource, /await readBoundedBody\((?:request|req)\)/i, `${routeName} must inspect a bounded request stream`);
  assert.match(routeSource, /totalBytes\s*\+=\s*value\.byteLength[\s\S]*?totalBytes\s*>\s*MAX_WITHDRAWAL_REQUEST_BYTES/i, `${routeName} must enforce actual streamed byte size`);
  assert.match(routeSource, /JSON\.parse\(rawBody\)/i, `${routeName} must reject malformed JSON`);
  assert.match(routeSource, /Array\.isArray\(parsed\)/i, `${routeName} must reject array bodies`);
}

assert.match(service, /Per-withdrawal and rolling 24-hour limits are authoritative in[\s\S]*?public\.request_withdrawal/i,
  'withdrawal velocity limits must be checked inside the atomic database reservation');
assert.match(currentWithdrawalContract, /FROM public\.profiles[\s\S]*?WHERE id = p_user_id[\s\S]*?FOR UPDATE/i,
  'the current withdrawal contract must serialize a user before calculating limits');
assert.match(currentWithdrawalContract, /Maximum single withdrawal limit exceeded[\s\S]*?Rolling 24-hour withdrawal limit exceeded/i,
  'the current withdrawal contract must enforce single and rolling 24-hour limits');
assert.match(service, /rpc\('request_withdrawal_idempotent'/i);
assert.match(service, /'get_withdrawal_idempotency_replay'/i);
assert.match(service, /typeof input\.idempotencyKey !== 'string'[\s\S]*?input\.idempotencyKey\.length < 16[\s\S]*?input\.idempotencyKey\.length > 128/i,
  'withdrawal service must reject missing and malformed idempotency keys');
assert.ok(service.includes('!/^[A-Za-z0-9._:-]+$/.test(input.idempotencyKey)'),
  'withdrawal service must restrict idempotency keys to safe characters');
assert.ok(
  service.indexOf("typeof input.idempotencyKey !== 'string'") <
  service.indexOf("'get_withdrawal_idempotency_replay'") &&
  service.indexOf("typeof input.idempotencyKey !== 'string'") <
  service.indexOf('const { data: replayLookup, error: replayLookupError }'),
  'idempotency key validation must happen before replay lookup'
);
assert.equal((service.match(/status: 'INVALID_IDEMPOTENCY_KEY'/g) || []).length, 1,
  'idempotency key must be validated in one early guard, not duplicated after spending-limit checks');
assert.match(service, /Every request uses the idempotent reservation RPC/i,
  'withdrawal reservation must always use the idempotent wrapper');
assert.doesNotMatch(service, /else\s*\{\s*const result = await supabaseAdmin\.rpc\('request_withdrawal'/i,
  'withdrawal service must not bypass idempotency with a direct reservation RPC');
assert.match(service, /IDEMPOTENCY_LOOKUP_UNAVAILABLE/i);
assert.match(service, /replayLookup\.found === true[\s\S]*?return \{[\s\S]*?withdrawalId: savedWithdrawalId/i,
  'exact retries must return the original withdrawal instead of reserving again');
assert.ok(
  service.indexOf("'get_withdrawal_idempotency_replay'") <
  service.indexOf('const feeInfo = await resolveAuthoritativeWithdrawalFee') &&
  service.indexOf("'get_withdrawal_idempotency_replay'") <
  service.indexOf("'request_withdrawal_idempotent'"),
  'replay lookup must happen before fresh fee checks and atomic reservation'
);
assert.match(service, /This idempotency key was already used for different withdrawal details/i);
assert.doesNotMatch(service, /\.eq\('destination_address', validDestination\)[\s\S]*?\.eq\('amount', parsedAmount\)/,
  'do not infer a retry merely from equal amount and destination');
assert.match(service, /RESERVATION_UNCONFIRMED/i,
  'ambiguous RPC responses must not be reported as confirmed success');

assert.match(client, /'x-idempotency-key': idempotencyKey/i);
assert.match(client, /getOrCreatePendingWithdrawalKeyDetails\(userId, withdrawalFingerprint\)/i,
  'withdrawal client must obtain the retry key from persistent user-scoped storage');
assert.match(client, /if \(!retry\.reused\)[\s\S]*?setRawBalances/i,
  'a retry must not apply a second optimistic debit');
assert.match(client, /if\s*\(\s*!res\.ok[\s\S]*?throw new Error/i,
  'ambiguous or failed HTTP responses must preserve the retry key');
assert.match(client, /clearPendingWithdrawalKey\(userId, withdrawalFingerprint, idempotencyKey\)/i,
  'a definitively successful response clears only the exact pending key');
assert.match(retryStore, /crypto\.subtle\.digest\('SHA-256'/i,
  'persistent storage keys must be derived from a digest of the intent');
assert.match(retryStore, /storage\.setItem\(storageKey, JSON\.stringify\(record\)\)/i,
  'retry key must be persisted before the withdrawal is submitted');
assert.match(retryStore, /readRecord\(storage, storageKey\)\?\.key === expectedKey/i,
  'cleanup must not delete a newer retry key for the same intent');
assert.match(retryStore, /navigator\.locks\.request/i,
  'same-intent concurrent submissions must use Web Locks where supported');

assert.equal((processor.match(/settlementResult\?\.success !== true/g) || []).length, 4,
  'all four chain handlers must require an explicit successful settlement RPC result');
assert.equal((processor.match(/broadcast, but settlement persistence failed/g) || []).length, 4,
  'all four chain handlers must surface post-broadcast settlement failures for reconciliation');

assert.match(settlementMigration, /Confirmed transaction hash is required to complete withdrawal/i,
  'completion must require a non-empty transaction hash');
assert.match(settlementMigration, /SET in_withdrawal = in_withdrawal - v_total_deducted,[\s\S]*?AND in_withdrawal >= v_total_deducted/i,
  'completion must release only the exact available locked liability');
assert.match(settlementMigration, /SET balance = balance \+ v_total_refund,[\s\S]*?AND in_withdrawal >= v_total_refund/i,
  'refund must not credit spendable balance unless the exact locked liability exists');
assert.equal((settlementMigration.match(/Wallet asset liability row missing or insufficient for withdrawal/g) || []).length, 2,
  'completion and refund must fail closed if the wallet liability is missing or insufficient');
assert.match(settlementMigration, /p_is_verified_revert BOOLEAN DEFAULT FALSE,\s*p_is_verified_unbroadcast BOOLEAN DEFAULT FALSE/i,
  'refund RPC must distinguish verified on-chain revert from verified pre-broadcast failure');
assert.match(settlementMigration, /IF NOT COALESCE\(p_is_verified_revert, FALSE\)[\s\S]*?AND NOT COALESCE\(p_is_verified_unbroadcast, FALSE\)[\s\S]*?RAISE EXCEPTION/i,
  'refund must fail closed when neither failure condition is verified');
assert.match(settlementMigration, /NOT IN \('pending', 'approved', 'queued', 'processing'\)/i,
  'pre-broadcast refunds must require an eligible status');
assert.match(settlementMigration, /NOT IN \('processing', 'broadcasted', 'ambiguous_broadcast'\)/i,
  'on-chain revert refunds must require an eligible status');

assert.match(settlementMigration, /FOR UPDATE SKIP LOCKED/i,
  'concurrent queue claimers must skip rows already locked by another worker');
assert.match(settlementMigration, /WHERE status = 'PENDING'[\s\S]*?FOR UPDATE SKIP LOCKED[\s\S]*?SET status = 'PROCESSING'/i,
  'queue claims must atomically transition pending rows to processing');
assert.match(workerRoute, /LEGACY_WITHDRAWAL_WORKER_DISABLED/i,
  'the duplicate worker endpoint must remain disabled');
assert.doesNotMatch(workerRoute, /claim_pending_withdrawals|record_withdrawal_broadcast|complete_onchain_withdrawal/i,
  'the retired endpoint must not claim, broadcast, or settle withdrawals');
assert.match(settlementMigration, /process_failed_withdrawal\(UUID, TEXT, NUMERIC, TEXT, BOOLEAN, BOOLEAN\)/i,
  'grant/revoke signature must match the updated refund RPC');
assert.match(settlementMigration, /SELECT id, status, tx_hash, txid[\s\S]*?FROM public\.withdrawals[\s\S]*?FOR UPDATE/i,
  'refund RPC must lock and inspect the companion withdrawal record');
assert.match(settlementMigration, /automatic unbroadcast refund denied/i,
  'pre-broadcast refund must reject records that already contain a transaction hash');
assert.match(settlementMigration, /automatic revert refund denied/i,
  'on-chain revert refund must require a consistent persisted transaction hash');
assert.match(settlementMigration, /Confirmed transaction hash does not match persisted on-chain hash/i,
  'completion must reject a confirmed hash that differs from the persisted on-chain hash');
assert.match(settlementMigration, /Confirmed transaction hash does not match persisted withdrawal hash/i,
  'completion must reject a hash that conflicts with the companion withdrawal record');
assert.match(settlementMigration, /inconsistent completion state; manual reconciliation required/i,
  'completion retries must reject inconsistent terminal states instead of returning success');
const withdrawalWorker = readFileSync('src/jobs/withdrawalWorker.ts', 'utf8');
const withdrawalLeaseMigration = readFileSync(
  'supabase/migrations/20261102212707_durable_withdrawal_broadcasts.sql',
  'utf8'
);
assert.match(withdrawalWorker, /p_worker_id: workerId/,
  'worker must pass its stable per-batch identity to the atomic row claim');
assert.match(withdrawalWorker, /worker_id\/lease_expires_at fence[\s\S]*?processWithdrawalQueue\(workerId\)/,
  'worker must use per-withdrawal lease fencing instead of a process-wide lease');
assert.match(withdrawalLeaseMigration, /FOR UPDATE SKIP LOCKED[\s\S]*?worker_id = p_worker_id[\s\S]*?lease_expires_at = pg_catalog\.clock_timestamp\(\) \+ interval '5 minutes'/i,
  'claim RPC must atomically claim an unlocked withdrawal and issue an expiring owner fence');
assert.match(withdrawalLeaseMigration, /worker_id IS DISTINCT FROM p_worker_id[\s\S]*?lease_expires_at <= pg_catalog\.clock_timestamp\(\)/i,
  'durable signing and broadcast RPCs must reject expired or mismatched worker ownership');
assert.match(restrictQueueClaimMigration, /REVOKE ALL ON FUNCTION public\.claim_pending_withdrawals\(INTEGER\) FROM PUBLIC, anon, authenticated/i,
  'untrusted roles must not invoke the SECURITY DEFINER withdrawal queue claim');
assert.match(restrictQueueClaimMigration, /GRANT EXECUTE ON FUNCTION public\.claim_pending_withdrawals\(INTEGER\) TO service_role, postgres/i,
  'only trusted worker/database roles should claim withdrawals');
assert.match(withdrawalWorker, /Lease-bound nonce allocation failed/i,
  'EVM withdrawal must fail closed when its durable nonce reservation fails');
assert.match(withdrawalWorker, /HOT_WALLET_NONCE_STREAM_BUSY:[\s\S]*?NONCE_STREAM_WAITING/i,
  'an unresolved earlier hot-wallet nonce must wait safely instead of being skipped');
assert.match(withdrawalWorker, /allocate_onchain_withdrawal_nonce[\s\S]*?p_onchain_pending_nonce: onchainPending/i,
  'nonce reservation must reconcile the database sequence with the chain pending nonce');
const tronProvider = readFileSync('src/lib/blockchain/tron.ts', 'utf8');
assert.match(tronProvider, /!txInfo[\s\S]*?!txInfo\.blockNumber[\s\S]*?success: undefined/,
  'missing or not-yet-indexed TRON transaction info must be treated as indeterminate');
assert.match(tronProvider, /catch \(err\)[\s\S]*?success: undefined/,
  'TRON RPC errors must not be treated as proof of transaction failure');
assert.match(tronProvider, /const receiptResult = String\([\s\S]*?receiptResult === 'SUCCESS'[\s\S]*?knownFailureResults\.has\(receiptResult\)/,
  'TRON transaction outcome must come from an explicit receipt result');
assert.match(withdrawalWorker, /success === false && confirmations >= TRON_CONFIG\.requiredConfirmations/,
  'TRON refunds must require an explicit failed transaction outcome after required confirmations');
assert.match(withdrawalWorker, /txData\.status\?\.confirmed === true/, 'BTC/LTC confirmation must be explicit');
assert.match(withdrawalWorker, /Number\.isSafeInteger\(txData\.fee\)/, 'BTC/LTC settlement must reject malformed fee data');
assert.match(withdrawalWorker, /confirmations >= chain.requiredConfirmations && status === 1/,
  'EVM settlement must require an explicit successful receipt status');
assert.doesNotMatch(withdrawalWorker, /confirmations >= chain.requiredConfirmations && status !== 0/,
  'unknown EVM receipt status must never be treated as successful');
assert.match(atomicBroadcastMigration, /CREATE OR REPLACE FUNCTION public\.record_onchain_withdrawal_broadcast/i);
assert.match(atomicBroadcastMigration, /SELECT \*[\s\S]*?FROM public\.onchain_withdrawals[\s\S]*?FOR UPDATE[\s\S]*?FROM public\.onchain_withdrawal_broadcasts[\s\S]*?FOR UPDATE/i,
  'broadcast RPC must lock the withdrawal and its durable signed payload');
assert.match(atomicBroadcastMigration, /Persisted signed withdrawal\/hash does not match the active broadcast lease/i,
  'broadcast retries must reject a hash that differs from the leased persisted payload');
assert.match(atomicBroadcastMigration, /CREATE TABLE IF NOT EXISTS public\.onchain_withdrawal_broadcasts[\s\S]*?signed_tx text NOT NULL[\s\S]*?tx_hash text NOT NULL/i,
  'broadcast recovery must retain signed bytes and their transaction hash durably');
assert.match(withdrawalSchemaParityMigration, /ALTER TABLE public\.withdrawals ADD COLUMN IF NOT EXISTS tx_hash TEXT/i,
  'prior schema migration must add withdrawals.tx_hash before atomic broadcast RPC uses it');
assert.match(withdrawalSchemaParityMigration, /ALTER TABLE public\.withdrawals ADD COLUMN IF NOT EXISTS broadcast_error TEXT/i,
  'prior schema migration must add withdrawals.broadcast_error before ambiguous recovery uses it');
assert.match(atomicBroadcastMigration, /UPDATE public\.onchain_withdrawal_broadcasts[\s\S]*?UPDATE public\.onchain_withdrawals[\s\S]*?UPDATE public\.withdrawals[\s\S]*?RETURN pg_catalog\.jsonb_build_object/i,
  'broadcast state and paired withdrawal mirror must update in one database transaction');
assert.match(atomicBroadcastMigration, /REVOKE ALL ON FUNCTION public\.record_onchain_withdrawal_broadcast\(uuid,text,text\)[\s\S]*?FROM PUBLIC, anon, authenticated/i,
  'broadcast state RPC must not be callable by untrusted roles');
assert.equal((withdrawalWorker.match(/rpc\('record_onchain_withdrawal_broadcast'/g) || []).length, 3,
  'TRON and EVM broadcasts must use the atomic database transition');
assert.match(atomicBroadcastMigration, /CREATE OR REPLACE FUNCTION public\.mark_withdrawal_ambiguous_broadcast/i);
assert.match(atomicBroadcastMigration, /Ambiguous withdrawal requires the exact persisted signed transaction/i);
assert.match(atomicBroadcastMigration, /terminal and cannot be reused/i);
assert.match(atomicBroadcastMigration, /REVOKE ALL ON FUNCTION public\.mark_withdrawal_ambiguous_broadcast\(uuid,text,text,text\)[\s\S]*?FROM PUBLIC, anon, authenticated/i);
assert.match(withdrawalWorker, /rpc\('mark_withdrawal_ambiguous_broadcast',[\s\S]*?p_tx_hash: broadcastTxHash,/i,
  'uncertain broadcast recovery must use the atomic RPC and preserve a known hash');
assert.doesNotMatch(withdrawalWorker, /\.from\('onchain_withdrawals'\)\s*\.update\(\{\s*status: 'AMBIGUOUS_BROADCAST'/i,
  'ambiguous state must not be written as a separate direct table update');
assert.match(withdrawalWorker, /broadcastTxHash = txHash/i,
  'known EVM transaction hash must be retained for ambiguous reconciliation');
assert.match(withdrawalWorker, /broadcastTxHash = prepared\.txHash/i,
  'known TRON transaction hash must be retained for ambiguous reconciliation');
assert.match(withdrawalWorker, /TRON transaction reverted on-chain'[\s\S]*?p_is_verified_unbroadcast: true/i,
  'current refund contract must receive the verified-failure flag after TRON finality and payload checks');
assert.match(withdrawalWorker, /if \(error \|\| !settings\)[\s\S]*?allowed: false, reason: 'Withdrawal controls could not be verified/i,
  'withdrawal dispatch must fail closed if platform settings cannot be read');
assert.match(withdrawalWorker, /catch \(err\) \{\s*return \{ allowed: false, reason: 'Withdrawal controls could not be verified/i,
  'withdrawal dispatch must fail closed if settings lookup throws');
assert.match(withdrawalWorker, /rpc\('record_onchain_withdrawal_broadcast',[\s\S]*?p_tx_hash: prepared\.txHash/i,
  'TRON broadcast must persist its transaction hash through the atomic transition');
assert.match(withdrawalWorker, /rpc\('record_onchain_withdrawal_broadcast',[\s\S]*?p_tx_hash: txHash/i,
  'EVM broadcast must persist its transaction hash through the atomic transition');
assert.match(withdrawalWorker, /txHash,[\s\S]*?nonce,[\s\S]*?status: 'BROADCASTED'/i,
  'EVM dispatch result must report broadcasted, not completed, before confirmations');
assert.match(withdrawalWorker, /p_gas_asset: 'BTC',[\s\S]*?settlementData\.success !== true[\s\S]*?confirmed\+\+/i,
  'BTC worker must only count settlement as confirmed when the RPC reports success');
assert.match(withdrawalWorker, /p_gas_asset: 'LTC',[\s\S]*?settlementData\.success !== true[\s\S]*?confirmed\+\+/i,
  'LTC worker must only count settlement as confirmed when the RPC reports success');
assert.match(withdrawalWorker, /EVM transaction reverted on-chain on network \$\{w\.network\}`[\s\S]*?p_is_verified_unbroadcast: true/i,
  'current refund contract must receive the verified-failure flag only after EVM receipt proof');

// USD valuation must fail closed instead of inventing a $1 price for volatile assets.
assert.match(fees, /Never invent a \$1 price for a volatile asset/i);
assert.match(fees, /throw new Error\(`Authoritative USD price unavailable for \$\{asset\}`\)/i);
assert.doesNotMatch(fees, /Default fallback if unavailable\s*return 1\.0/i);

// Rolling-limit regressions: prior withdrawals must never disappear from the USD total
// merely because a non-stable asset's USD price is missing from the market-price table.
assert.match(canonicalWithdrawalMigration, /ROLLING 24-HOUR DAILY LIMIT/i);
assert.match(canonicalWithdrawalMigration, /FROM public\.crypto_market_prices/i);
assert.equal(
  (canonicalWithdrawalMigration.match(/COALESCE\(LOWER\(TRIM\(w\.status\)\), ''\) NOT IN \('rejected', 'failed', 'cancelled'\)/g) || []).length,
  3,
  'NULL or whitespace withdrawal statuses must be counted conservatively in both history guards and the rolling limit'
);
assert.match(
  canonicalWithdrawalMigration,
  /NOT IN \('USDT', 'USDC', 'BTC', 'ETH', 'LTC'\)[\s\S]*?HISTORICAL_ASSET_UNAVAILABLE/i,
  'prior withdrawals with missing or unsupported asset identity must fail closed'
);
assert.match(
  canonicalWithdrawalMigration,
  /IF EXISTS \([\s\S]*?FROM public\.withdrawals w[\s\S]*?cmp\.price_in_fiat IS NULL OR cmp\.price_in_fiat <= 0[\s\S]*?HISTORICAL_VALUATION_UNAVAILABLE[\s\S]*?END IF;[\s\S]*?SELECT COALESCE\(SUM\(/i,
  'historical non-stable withdrawals with missing or invalid prices must be rejected before the rolling total is calculated'
);

// SECURITY DEFINER functions use an empty search_path; all application objects are schema-qualified.
assert.match(migration, /SECURITY DEFINER[\s\S]*?SET search_path = ''/i,
  'idempotency wrapper must not resolve objects from writable schemas');
assert.match(replayLookupMigration, /SECURITY DEFINER[\s\S]*?SET search_path = ''/i,
  'replay lookup must not resolve objects from writable schemas');
assert.doesNotMatch(migration, /SET search_path = (?:public|auth)\s*,/i);
assert.doesNotMatch(replayLookupMigration, /SET search_path = public\s*,/i);
console.log('PASS: withdrawal idempotency and settlement source contract checks.');
console.log('NOTE: static checks only; PostgreSQL concurrency/replay behavior still needs an isolated database test.');
