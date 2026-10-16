import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');
const checks: Array<[string, string, RegExp]> = [
  [
    'deposit credit RPCs are not executable by browser roles',
    'supabase/migrations/20261016000000_restrict_deposit_credit_rpc.sql',
    /REVOKE ALL ON FUNCTION public\.process_confirmed_deposit\(uuid\) FROM PUBLIC;[\s\S]*REVOKE ALL ON FUNCTION public\.process_confirmed_deposit\(uuid\) FROM anon;[\s\S]*REVOKE ALL ON FUNCTION public\.process_confirmed_deposit\(uuid\) FROM authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.process_confirmed_deposit\(uuid\) TO service_role;/i,
  ],
  [
    'legacy parameter-based deposit credit RPC is disabled',
    'supabase/migrations/20261016000002_disable_legacy_direct_deposit_credit.sql',
    /RAISE EXCEPTION[\s\S]*REVOKE ALL ON FUNCTION public\.process_confirmed_deposit\(uuid, numeric, text, text, text\) FROM authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.process_confirmed_deposit\(uuid, numeric, text, text, text\) TO service_role;/i,
  ],
  [
    'legacy process_user_deposit RPC is disabled and server-only',
    'supabase/migrations/20261016000003_disable_legacy_process_user_deposit.sql',
    /RAISE EXCEPTION[\s\S]*REVOKE ALL ON FUNCTION public\.process_user_deposit\(uuid, text, text, text, numeric, text\) FROM anon;[\s\S]*REVOKE ALL ON FUNCTION public\.process_user_deposit\(uuid, text, text, text, numeric, text\) FROM authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.process_user_deposit\(uuid, text, text, text, numeric, text\) TO service_role;/i,
  ],
  [
    'confirmed-deposit RPC checks state and confirmation threshold',
    'supabase/migrations/20261016000001_require_confirmed_deposit_before_credit.sql',
    /v_deposit\.status <> 'CONFIRMED'[\s\S]*v_deposit\.confirmations < v_deposit\.required_confirmations/i,
  ],
  [
    'deposit ledger conflict aborts credit transaction',
    'supabase/migrations/20261016000001_require_confirmed_deposit_before_credit.sql',
    /GET DIAGNOSTICS v_ledger_rows = ROW_COUNT;[\s\S]*IF v_ledger_rows <> 1 THEN[\s\S]*RAISE EXCEPTION/i,
  ],
  [
    'withdrawal claim batch uses row locking to avoid double claims',
    'supabase/migrations/20261016000006_bound_withdrawal_claim_batch.sql',
    /FOR UPDATE SKIP LOCKED/i,
  ],
  [
    'withdrawal claim RPC revokes authenticated execution in bounded migration',
    'supabase/migrations/20261016000006_bound_withdrawal_claim_batch.sql',
    /REVOKE ALL ON FUNCTION public\.claim_pending_withdrawals\(INTEGER\) FROM authenticated/i,
  ],
  [
    'withdrawal claim RPC grants only service role in bounded migration',
    'supabase/migrations/20261016000006_bound_withdrawal_claim_batch.sql',
    /GRANT EXECUTE ON FUNCTION public\.claim_pending_withdrawals\(INTEGER\) TO service_role/i,
  ],
  [
    'withdrawal worker checks both ambiguous status persistence operations',
    'src/jobs/withdrawalWorker.ts',
    /const \{ error: onchainStatusError \}[\s\S]*if \(onchainStatusError\)[\s\S]*const \{ error: withdrawalStatusError \}[\s\S]*if \(withdrawalStatusError\)/i,
  ],
  [
    'EVM withdrawal worker waits for a successful receipt before completing accounting',
    'src/jobs/withdrawalWorker.ts',
    /tx = await (?:signer\.sendTransaction|tokenContract\.transfer)\([\s\S]*?const receipt = await tx\.wait\(1\)[\s\S]*?if \(!receipt \|\| receipt\.status !== 1\)[\s\S]*?complete_onchain_withdrawal/i,
  ],
  [
    'TRON withdrawal poller refunds only explicit mined failures',
    'src/jobs/withdrawalWorker.ts',
    /const \{ isConfirmed, success, isFailed, actualCostTrx \} = await getTronTransactionConfirmations\(w\.tx_hash\)[\s\S]*?else if \(isFailed && !success\)[\s\S]*?p_is_verified_unbroadcast: false/i,
  ],
  [
    'TRON confirmation helper distinguishes pending transactions from mined failures',
    'src/lib/blockchain/tron.ts',
    /isFailed: boolean[\s\S]*?isFailed: false[\s\S]*?isFailed: Boolean\(txInfo\.receipt\?\.result && txInfo\.receipt\.result !== 'SUCCESS'\)/i,
  ],
  [
    'withdrawal poller checks EVM refund RPC errors after verified reverts',
    'src/jobs/withdrawalWorker.ts',
    /status === 0\)[\s\S]*?const \{ error: failedErr \} = await supabaseAdmin\.rpc\('process_failed_withdrawal'[\s\S]*?if \(failedErr\)[\s\S]*?funds remain reserved/i,
  ],
  [
    'withdrawal poller checks TRON refund RPC errors after verified reverts',
    'src/jobs/withdrawalWorker.ts',
    /isFailed && !success\)[\s\S]*?const \{ error: failedErr \} = await supabaseAdmin\.rpc\('process_failed_withdrawal'[\s\S]*?p_is_verified_unbroadcast: true[\s\S]*?if \(failedErr\)[\s\S]*?funds remain reserved/i,
  ],
  [
    'withdrawal worker treats completion RPC errors after broadcast as ambiguous failures',
    'src/jobs/withdrawalWorker.ts',
    /const \{ error: completionError \} = await supabaseAdmin\.rpc\('complete_onchain_withdrawal'[\s\S]*?if \(completionError\)[\s\S]*?throw new Error[\s\S]*?const \{ error: completionError \} = await supabaseAdmin\.rpc\('complete_onchain_withdrawal'[\s\S]*?if \(completionError\)[\s\S]*?throw new Error/i,
  ],
  [
    'withdrawal amount validator uses digit and decimal escapes correctly',
    'src/jobs/withdrawalWorker.ts',
    /Number\.isFinite\(Number\(amountStr\)\)/,
  ],
  [
    'withdrawal worker validates queued withdrawal fields before network interaction',
    'src/jobs/withdrawalWorker.ts',
    /Withdrawal amount must be a finite positive decimal[\s\S]*Withdrawal destination is missing[\s\S]*Unsupported withdrawal network/i,
  ],
  [
    'withdrawal claim casts auth ban expiry to timestamptz',
    'supabase/migrations/20261016000006_bound_withdrawal_claim_batch.sql',
    /NULLIF\(u\.banned_until, ''\)::timestamptz > NOW\(\)/,
  ],
  [
    'withdrawal worker validates EVM asset and amount before allocating nonce',
    'src/jobs/withdrawalWorker.ts',
    /const tokenContractAddress = isNativeTransfer \? null : getTokenContractAddress\(network, assetSymbol\)[\s\S]*Unsupported withdrawal asset[\s\S]*const parsedAmount = ethers\.parseUnits\([\s\S]*const nonce = await allocateEvmNonce/i,
  ],
  [
    'withdrawal worker verifies configured EVM chain before broadcast',
    'src/jobs/withdrawalWorker.ts',
    /const connectedNetwork = await provider\.getNetwork\(\)[\s\S]*connectedNetwork\.chainId !== BigInt\(chainConfig\.chainId\)[\s\S]*RPC chain ID mismatch/i,
  ],
  [
    'withdrawal worker rejects null and malformed nonce allocation results',
    'src/jobs/withdrawalWorker.ts',
    /allocatedNonce === null[\s\S]*allocatedNonce === undefined[\s\S]*!\\/\\^\\d\\+\\$\\/\.test\\(allocatedNonce\\)/i,
  ],
  [
    'nonce allocator rejects unsupported networks and invalid pending nonces',
    'supabase/migrations/20261016000007_bind_nonce_allocation_to_hot_wallet.sql',
    /v_norm_network NOT IN \('ERC20', 'BEP20', 'POLYGON'\)[\s\S]*p_onchain_pending_nonce IS NULL[\s\S]*p_onchain_pending_nonce < 0/i,
  ],
  [
    'nonce allocation binds seeded zero-address placeholder without allowing wallet switching',
    'supabase/migrations/20261016000007_bind_nonce_allocation_to_hot_wallet.sql',
    /Existing migrations seed placeholder zero addresses[\s\S]*LOWER\(TRIM\(COALESCE\(v_hot_wallet_address, ''\)\)\) = '0x0{40}'[\s\S]*RAISE EXCEPTION 'Configured hot-wallet address mismatch/i,
  ],
  [
    'nonce allocation rejects a hot-wallet address mismatch and validates inputs',
    'supabase/migrations/20261016000007_bind_nonce_allocation_to_hot_wallet.sql',
    /NULLIF\(TRIM\(p_wallet_address\), ''\) IS NULL[\s\S]*p_onchain_pending_nonce < 0[\s\S]*LOWER\(TRIM\(v_hot_wallet_address\)\) <> LOWER\(TRIM\(p_wallet_address\)\)[\s\S]*REVOKE ALL ON FUNCTION public\.allocate_hot_wallet_nonce/i,
  ],
  [
    'withdrawal worker rejects invalid numeric nonce and guards parsing errors',
    'src/jobs/withdrawalWorker.ts',
    /!Number\.isSafeInteger\(allocatedNonce\)[\s\S]*BigInt\(allocatedNonce\)[\s\S]*catch \{[\s\S]*unparsable nonce/i,
  ],
  [
    'withdrawal worker parses nonce without unsafe numeric rounding',
    'src/jobs/withdrawalWorker.ts',
    /BigInt\(allocatedNonce\)[\s\S]*BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*Number\.isSafeInteger\(nonce\)/i,
  ],
  [
    'withdrawal worker refuses unsafe EVM nonce allocation fallback',
    'src/jobs/withdrawalWorker.ts',
    /Atomic hot-wallet nonce allocation unavailable; refusing withdrawal broadcast[\s\S]*allocated nonce returned an invalid or stale nonce|Atomic nonce allocation returned an invalid or stale nonce; refusing withdrawal broadcast/i,
  ],
  [
    'withdrawal worker handles returned refund RPC errors',
    'src/jobs/withdrawalWorker.ts',
    /const \{ error: refundError \} = await supabaseAdmin\.rpc\('process_failed_withdrawal'[\s\S]*if \(refundError\)[\s\S]*Refund RPC returned an error/i,
  ],
  [
    'withdrawal worker detects returned lock-release RPC errors',
    'src/jobs/withdrawalWorker.ts',
    /const \{ error: unlockError \} = await supabaseAdmin\.rpc\('release_withdrawal_worker_lock'\)[\s\S]*if \(unlockError\)[\s\S]*Lock release RPC failed; operator intervention may be required/i,
  ],
  [
    'withdrawal worker bounds caller-supplied dispatch batch size',
    'src/jobs/withdrawalWorker.ts',
    /if \(!Number\.isInteger\(maxBatch\) \|\| maxBatch < 1 \|\| maxBatch > 100\)[\s\S]*Invalid maxBatch; refusing to dispatch withdrawals/i,
  ],
  [
    'withdrawal worker refuses dispatch when singleton lock cannot be acquired',
    'src/jobs/withdrawalWorker.ts',
    /if \(lockErr\)[\s\S]*refusing to dispatch withdrawals[\s\S]*if \(lockAcquired !== true\)[\s\S]*return \{ totalProcessed: 0, results: \[\], locked: true \}[\s\S]*catch \(lockRpcErr\)[\s\S]*refusing to dispatch withdrawals/i,
  ],
  [
    'withdrawal worker honors the global emergency kill switch',
    'src/jobs/withdrawalWorker.ts',
    /if \(settings\.global_kill_switch_active\)[\s\S]*return \{ allowed: false/i,
  ],
  [
    'withdrawal worker honors administrator withdrawal pause',
    'src/jobs/withdrawalWorker.ts',
    /if \(!settings\.withdrawals_enabled\)[\s\S]*return \{ allowed: false/i,
  ],
  [
    'withdrawal worker fails closed when circuit-breaker settings are unavailable',
    'src/jobs/withdrawalWorker.ts',
    /if \(error \|\| !settings\)[\s\S]*return \{ allowed: false[\s\S]*catch \(err\)[\s\S]*return \{ allowed: false/i,
  ],
  [
    'withdrawal claims require active provisioned wallets',
    'supabase/migrations/20261016000006_bound_withdrawal_claim_batch.sql',
    /EXISTS \([\s\S]*FROM public\.wallets wal[\s\S]*wal\.status = 'active'[\s\S]*wal\.provisioning_status = 'completed'/i,
  ],
  [
    'withdrawal claims require an existing eligible auth user',
    'supabase/migrations/20261016000006_bound_withdrawal_claim_batch.sql',
    /AND EXISTS \([\s\S]*FROM auth\.users u[\s\S]*u\.id = w\.user_id[\s\S]*NOT COALESCE\(u\.banned_until > NOW\(\), FALSE\)/i,
  ],
  [
    'withdrawal claims exclude banned or restricted owners',
    'supabase/migrations/20261016000006_bound_withdrawal_claim_batch.sql',
    /FROM auth\.users u[\s\S]*u\.banned_until > NOW\(\)[\s\S]*raw_app_meta_data ->> 'restricted'/i,
  ],
  [
    'withdrawal claim batch is bounded and browser roles remain revoked',
    'supabase/migrations/20261016000006_bound_withdrawal_claim_batch.sql',
    /p_limit IS NULL OR p_limit < 1 OR p_limit > 100/i,
  ],
  [
    'withdrawal claimant is restricted to service role',
    'supabase/migrations/20261016000005_restrict_withdrawal_claim_rpc.sql',
    /REVOKE ALL ON FUNCTION public\.claim_pending_withdrawals\(INTEGER\) FROM PUBLIC;[\s\S]*REVOKE ALL ON FUNCTION public\.claim_pending_withdrawals\(INTEGER\) FROM anon;[\s\S]*REVOKE ALL ON FUNCTION public\.claim_pending_withdrawals\(INTEGER\) FROM authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.claim_pending_withdrawals\(INTEGER\) TO service_role;/i,
  ],
  [
    'canonical deposit RPC is restricted to server roles',
    'supabase/migrations/20261016000004_lock_canonical_deposit_rpc_to_server_roles.sql',
    /REVOKE ALL ON FUNCTION public\.process_deposit_atomic\([\s\S]*?FROM anon;[\s\S]*?REVOKE ALL ON FUNCTION public\.process_deposit_atomic\([\s\S]*?FROM authenticated;[\s\S]*?GRANT EXECUTE ON FUNCTION public\.process_deposit_atomic\([\s\S]*?TO service_role, postgres;/i,
  ],
  [
    'TRON receipt block hash is bound to the verified log',
    'src/jobs/depositIngestion.ts',
    /receipt\.blockHash\.toLowerCase\(\) !== log\.blockHash\.toLowerCase\(\)/i,
  ],
  [
    'deposit ingestion requires the service-role secret and has no anon-key fallback',
    'src/jobs/depositIngestion.ts',
    /const serviceRoleKey = process\.env\.SUPABASE_SERVICE_ROLE_KEY;[\s\S]{0,500}Missing SUPABASE_URL\/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/i,
  ],
  [
    'confirmed-deposit RPC refuses unconfigured or disabled assets',
    'supabase/migrations/20261016000001_require_confirmed_deposit_before_credit.sql',
    /FROM public\.assets[\s\S]{0,120}code = v_asset_code[\s\S]{0,100}is_enabled IS TRUE[\s\S]{0,180}Deposit asset % is not configured and enabled/i,
  ],
  [
    'legacy caller-parameter deposit RPC cannot perform a credit',
    'supabase/migrations/20261016000003_disable_legacy_process_user_deposit.sql',
    /CREATE OR REPLACE FUNCTION public\.process_user_deposit[\s\S]{0,700}RAISE EXCEPTION/i,
  ],
  [
    'chain-id nonce allocator fails closed when the network hot wallet is missing',
    'supabase/migrations/20261001020000_gas_funding_broadcast_durability_and_abuse_protection.sql',
    /IF v_hot_addr IS NULL OR TRIM\(v_hot_addr\) = '' THEN[\s\S]*RAISE EXCEPTION[\s\S]*RETURN public\.allocate_hot_wallet_nonce\(v_net, v_hot_addr, 0\)/i,
  ],
  [
    'gas funding eligibility validates network, address, amount and abuse limits',
    'supabase/migrations/20261001020000_gas_funding_broadcast_durability_and_abuse_protection.sql',
    /IF p_deposit_address IS NULL OR TRIM\(p_deposit_address\) = '' THEN[\s\S]*IF v_norm_net NOT IN \(\'ERC20\', \'BEP20\'\) THEN[\s\S]*IF p_amount_allocated IS NULL OR p_amount_allocated <= 0 THEN[\s\S]*p_daily_max_operations IS NULL OR p_daily_max_operations <= 0/i,
  ],
  [
    'gas funding claims require valid inputs and a live sweep lease owned by the worker',
    'supabase/migrations/20261001020000_gas_funding_broadcast_durability_and_abuse_protection.sql',
    /CREATE OR REPLACE FUNCTION public\.claim_gas_funding_operation[\s\S]*?IF p_sweep_id IS NULL OR p_worker_id IS NULL[\s\S]*?SELECT \* INTO v_sweep[\s\S]*?FROM public\.sweep_operations[\s\S]*?v_sweep\.worker_id IS DISTINCT FROM p_worker_id[\s\S]*?v_sweep\.lease_expires_at IS NULL OR v_sweep\.lease_expires_at <= NOW\(\)/i,
  ],
  [
    'signed gas funding persistence validates payload and refuses to overwrite non-pending operations',
    'supabase/migrations/20261001020000_gas_funding_broadcast_durability_and_abuse_protection.sql',
    /CREATE OR REPLACE FUNCTION public\.persist_signed_gas_funding[\s\S]*?p_signed_tx_hex IS NULL OR TRIM\(p_signed_tx_hex\) = ''[\s\S]*?v_sweep\.lease_expires_at IS NULL OR v_sweep\.lease_expires_at <= NOW\(\)[\s\S]*?IF v_gas\.status <> 'PENDING' THEN/i,
  ],
  [
    'gas funding eligibility RPC errors and malformed responses fail closed',
    'src/jobs/sweeperWorker.ts',
    /Gas funding eligibility check failed; refusing to fund[\s\S]*?if \(!eligibilityRes \|\| typeof eligibilityRes\.eligible !== 'boolean'\)[\s\S]*?Gas funding eligibility returned an invalid response; refusing to fund[\s\S]*?if \(!eligibilityRes\.eligible\)/i,
  ],
  [
    'gas recovery revalidates sweep ownership immediately before rebroadcast',
    'src/jobs/sweeperWorker.ts',
    /Revalidate ownership immediately before network side effects[\s\S]*?assertPreBroadcastOwnership\(sweepId, workerId, 'GAS_FUNDING_RECOVERY'\)[\s\S]*?provider\.broadcastTransaction\(existingSignedTx\)/i,
  ],
  [
    'fresh gas funding requires live sweep ownership immediately before broadcast',
    'src/jobs/sweeperWorker.ts',
    /Revalidate lease ownership after signing\/persistence[\s\S]*?assertPreBroadcastOwnership\(sweepId, workerId, 'GAS_FUNDING'\)[\s\S]*?Sweep ID and worker ID are required before gas funding broadcast[\s\S]*?provider\.broadcastTransaction\(signedTxHex\)/i,
  ],
  [
    'invalid gas funding abuse-protection configuration fails closed',
    'src/jobs/sweeperWorker.ts',
    /!Number\.isSafeInteger\(cooldownSecs\) \|\| cooldownSecs < 0[\s\S]*?!Number\.isFinite\(dailyLimitNative\) \|\| dailyLimitNative <= 0[\s\S]*?!Number\.isSafeInteger\(dailyMaxOps\) \|\| dailyMaxOps <= 0[\s\S]*?Invalid gas funding abuse-protection configuration; refusing to fund/i,
  ],
  [
    'TRON gas funding revalidates sweep ownership immediately before broadcast',
    'src/jobs/sweeperWorker.ts',
    /Revalidate ownership immediately before broadcasting the persisted transaction[\s\S]*?assertPreBroadcastOwnership\(sweepId, workerId, 'GAS_FUNDING'\)[\s\S]*?Sweep ID and worker ID are required before TRON gas funding broadcast[\s\S]*?sendRawTransaction\(signedTx\)/i,
  ],
  [
    'TRON gas funding rejects missing sweep or worker identity before side effects',
    'src/jobs/sweeperWorker.ts',
    /export async function fundTronGasForAddress[\s\S]*?if \(!sweepId \|\| !workerId\)[\s\S]*?Sweep ID and worker ID are required for durable TRON gas funding[\s\S]*?claim_gas_funding_operation/i,
  ],
  [
    'TRON gas funding confirmation timeout records recovery and aborts sweep progression',
    'src/jobs/sweeperWorker.ts',
    /Timed out waiting for TRON gas funding transaction confirmation[\s\S]*?status: 'RECOVERY_REQUIRED'[\s\S]*?throw new Error\(reason\)[\s\S]*?TRON gas funding confirmation/i,
  ],
  [
    'TRON gas funding validates recipient and positive safe-integer amount before claiming',
    'src/jobs/sweeperWorker.ts',
    /export async function fundTronGasForAddress[\s\S]*?if \(!targetAddress \|\| !Number\.isSafeInteger\(amountSun\) \|\| amountSun <= 0\)[\s\S]*?Invalid TRON gas funding recipient or amount[\s\S]*?claim_gas_funding_operation/i,
  ],
  [
    'missing TRON hot-wallet key records recovery and aborts instead of silently skipping',
    'src/jobs/sweeperWorker.ts',
    /const tronPrivKey = resolveTronHotWalletPrivateKey\(\)[\s\S]*?if \(!tronPrivKey\)[\s\S]*?status: 'RECOVERY_REQUIRED'[\s\S]*?HOT_WALLET_TRON_PRIVATE_KEY is not configured[\s\S]*?throw new Error\(message\)/i,
  ],
  [
    'TRON gas funding remains disabled unless durable TRC20 SQL support is explicitly enabled',
    'src/jobs/sweeperWorker.ts',
    /The deployed durable gas-funding SQL contract supports ERC20\/BEP20 only[\s\S]*?throw new Error\('TRON gas funding is disabled until a TRC20-compatible durable SQL workflow is deployed'\)/i,
  ],
  [
    'disabled TRON gas funding moves the sweep from GAS_FUNDING to RECOVERY_REQUIRED',
    'src/jobs/sweeperWorker.ts',
    /p_expected_status: 'GAS_FUNDING'[\s\S]*?p_new_status: 'RECOVERY_REQUIRED'[\s\S]*?failed to persist sweep recovery status[\s\S]*?throw new Error\(disabledReason\)/i,
  ],
  [
    'TRON account activation refuses default fee when chain parameters are unavailable or invalid',
    'src/jobs/sweeperWorker.ts',
    /Unable to verify the exact TRON account creation fee[\s\S]*?p_expected_status: currentStatus[\s\S]*?p_new_status: 'RECOVERY_REQUIRED'[\s\S]*?throw new Error\(reason\)/i,
  ],
  [
    'TRON energy estimation failure verifies recovery status persistence',
    'src/jobs/sweeperWorker.ts',
    /Dynamic energy estimation failed:[\s\S]*?const \{ data: recoveryRes, error: recoveryErr \}[\s\S]*?recoveryRes\.success !== true[\s\S]*?failed to persist sweep recovery status/i,
  ],
  [
    'TRON ambiguous broadcast checks recovery RPC outcome',
    'src/jobs/sweeperWorker.ts',
    /recoveryReason = broadcastErr[\s\S]*?p_new_status: 'RECOVERY_REQUIRED'[\s\S]*?recoveryRes\.success !== true[\s\S]*?deterministicTxHash/i,
  ],
  [
    'TRON energy estimate must be a positive safe integer',
    'src/jobs/sweeperWorker.ts',
    /const estimatedEnergy = Number\(estimateRes\?\.energy_used\)[\s\S]*?Number\.isSafeInteger\(estimatedEnergy\)[\s\S]*?estimatedEnergy <= 0/i,
  ],
  [
    'TRON sweep validates the hot-wallet destination address',
    'src/jobs/sweeperWorker.ts',
    /!tronWeb\.isAddress\(hotWalletDestination\)[\s\S]*?TRON hot wallet destination address is missing or invalid/i,
  ],
  [
    'TRON USDT balance is parsed as an exact integer before transaction construction',
    'src/jobs/sweeperWorker.ts',
    /const rawBalance = balanceSun\?\.toString\?\.\(\) \?\? String\(balanceSun\)[\s\S]*?balanceSunInteger = BigInt\(rawBalance\)[\s\S]*?value: balanceSunInteger\.toString\(\)/i,
  ],
  [
    'TRON sweep requires an explicit valid token contract for the configured network',
    'src/jobs/sweeperWorker.ts',
    /const usdtContractAddress = process\.env\.USDT_CONTRACT_TRC20\?\.trim\(\)[\s\S]*?!tronWeb\.isAddress\(usdtContractAddress\)[\s\S]*?USDT_CONTRACT_TRC20 is missing or invalid/i,
  ],
  [
    'TRON pre-broadcast cleanup fails closed on RPC errors and checks undelegation result',
    'src/jobs/sweeperWorker.ts',
    /const \{ data: cleanupRes, error: cleanupErr \} = await supabaseAdmin\.rpc\('verify_and_lock_pre_broadcast_cleanup'[\s\S]*?if \(cleanupErr \|\| !cleanupRes \|\| cleanupRes\.can_undelegate !== true\)[\s\S]*?const undelegated = await undelegateEnergyToPool\(sweepId, workerId\)[\s\S]*?if \(!undelegated\)/i,
  ],
  [
    'TRON undelegation validates persisted receiver and amount before transaction construction',
    'src/jobs/sweeperWorker.ts',
    /const rawDelegatedAmount = String\(delegation\.delegated_amount_sun \?\? ''\)[\s\S]*?!tronWeb\.isAddress\(receiverAddress\)[\s\S]*?!Number\.isSafeInteger\(trxNeededSun\)[\s\S]*?trxNeededSun <= 0/i,
  ],
];

let failed = 0;
for (const [name, path, pattern] of checks) {
  try {
    assert.match(read(path), pattern);
    console.log('PASS', name);
  } catch (error) {
    failed += 1;
    console.error('FAIL', name, error instanceof Error ? error.message : error);
  }
}

console.log(`Deposit SQL/source regression checks: ${checks.length - failed}/${checks.length} passed`);
if (failed > 0) process.exitCode = 1;
