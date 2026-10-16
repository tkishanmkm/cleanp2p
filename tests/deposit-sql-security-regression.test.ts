import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');
const checks: Array<[string, string, RegExp]> = [
  [
    'pending sweep reconciliation checks recovery-state persistence',
    'src/jobs/sweeperWorker.ts',
    /Unconfirmed transaction \$\{sweep_tx_hash\} moved to RECOVERY_REQUIRED[\s\S]*?Failed to persist pending sweep recovery status[\s\S]*?recoveryRes\.success !== true/i,
  ],
  [
    'sweep reconciliation checks failed-status persistence',
    'src/jobs/sweeperWorker.ts',
    /if \(isFailed\)[\s\S]*?p_new_status: 'FAILED'[\s\S]*?Failed to persist failed sweep status[\s\S]*?failedRes\.success !== true/i,
  ],
  [
    'sweep missing transaction hash checks recovery-state persistence',
    'src/jobs/sweeperWorker.ts',
    /Ambiguous sweep in \$\{status\} without transaction hash[\s\S]*?Sweep Recovery Persistence Failure: missing transaction hash[\s\S]*?recoveryRes\.success !== true/i,
  ],
  [
    'BTC/LTC recovery rebroadcast exception checks recovery-state persistence',
    'src/jobs/sweeperWorker.ts',
    /BTC\/LTC Sweeper Broadcast Exception during READY_TO_BROADCAST recovery[\s\S]*?BTC\/LTC Sweep Recovery Persistence Failure after broadcast exception[\s\S]*?recoveryRes\.success !== true/i,
  ],
  [
    'BTC/LTC recovery hash mismatch checks recovery-state persistence',
    'src/jobs/sweeperWorker.ts',
    /Hash consistency check failed on recovery: derived[\s\S]*?BTC\/LTC Sweep Recovery Persistence Failure[\s\S]*?recoveryRes\.success !== true/i,
  ],
  [
    'BTC/LTC recovery hash calculation failure checks recovery-state persistence',
    'src/jobs/sweeperWorker.ts',
    /Hash calculation error:[\s\S]*?BTC\/LTC Sweep Recovery Persistence Failure[\s\S]*?recoveryRes\.success !== true/i,
  ],
  [
    'BTC/LTC recovery missing signed transaction checks recovery-state persistence',
    'src/jobs/sweeperWorker.ts',
    /Durability invariant violation: signed_tx_hex is NULL for READY_TO_BROADCAST BTC\/LTC sweep[\s\S]*?BTC\/LTC Sweep Recovery Persistence Failure[\s\S]*?recoveryRes\.success !== true/i,
  ],
  [
    'EVM recovery rebroadcast exception checks recovery-state persistence',
    'src/jobs/sweeperWorker.ts',
    /EVM Sweeper Broadcast Exception during READY_TO_BROADCAST recovery[\s\S]*?EVM Sweep Recovery Persistence Failure after broadcast exception[\s\S]*?recoveryRes\.success !== true/i,
  ],
  [
    'EVM recovery nonce mismatch checks recovery-state persistence',
    'src/jobs/sweeperWorker.ts',
    /Nonce consistency check failed on recovery[\s\S]*?recoveryRes\.success !== true[\s\S]*?EVM Sweep Recovery Persistence Failure/i,
  ],
  [
    'EVM recovery parse failure checks recovery-state persistence',
    'src/jobs/sweeperWorker.ts',
    /Failed to parse signed transaction on recovery[\s\S]*?recoveryRes\.success !== true[\s\S]*?EVM Sweep Recovery Persistence Failure/i,
  ],
  [
    'EVM recovered signed transaction hash mismatch checks recovery-state persistence',
    'src/jobs/sweeperWorker.ts',
    /if \(derivedHash !== sweep_tx_hash\)[\s\S]*?Hash consistency check failed on recovery[\s\S]*?recoveryRes\.success !== true[\s\S]*?EVM Sweep Recovery Persistence Failure/i,
  ],
  [
    'EVM invalid signed transaction hash checks recovery-state persistence',
    'src/jobs/sweeperWorker.ts',
    /catch \(hashErr: any\)[\s\S]*?Hash calculation error:[\s\S]*?recoveryRes\.success !== true[\s\S]*?EVM Sweep Recovery Persistence Failure/i,
  ],
  [
    'EVM sweep missing signed transaction logs recovery persistence failure',
    'src/jobs/sweeperWorker.ts',
    /if \(!signed_tx_hex\)[\s\S]*?const \{ data: recoveryRes, error: recoveryErr \} = await supabaseAdmin\.rpc\('update_sweep_operation_status'[\s\S]*?recoveryRes\.success !== true[\s\S]*?EVM Sweep Recovery Persistence Failure/i,
  ],
  [
    'EVM token ambiguous broadcast checks RECOVERY_REQUIRED persistence',
    'src/jobs/sweeperWorker.ts',
    /EVM Sweeper Broadcast Exception\] Token transfer[\s\S]*?let recoveryPersistError: string \| null = null[\s\S]*?recoveryRes\.success !== true[\s\S]*?EVM Token Sweeper Recovery Persistence Failure[\s\S]*?EVM token broadcast outcome ambiguous/i,
  ],
  [
    'EVM native ETH ambiguous broadcast checks RECOVERY_REQUIRED persistence',
    'src/jobs/sweeperWorker.ts',
    /EVM Sweeper Broadcast Exception\] Native ETH[\s\S]*?let recoveryPersistError: string \| null = null[\s\S]*?recoveryRes\.success !== true[\s\S]*?EVM ETH Sweeper Recovery Persistence Failure[\s\S]*?EVM ETH broadcast outcome ambiguous/i,
  ],
  [
    'LTC ambiguous broadcast checks RECOVERY_REQUIRED persistence',
    'src/jobs/sweeperWorker.ts',
    /LTC Sweeper Broadcast Exception[\s\S]*?let recoveryPersistError: string \| null = null[\s\S]*?recoveryRes\.success !== true[\s\S]*?LTC Sweeper Recovery Persistence Failure[\s\S]*?LTC broadcast outcome ambiguous/i,
  ],
  [
    'BTC ambiguous broadcast checks RECOVERY_REQUIRED persistence',
    'src/jobs/sweeperWorker.ts',
    /BTC Sweeper Broadcast Exception[\s\S]*?let recoveryPersistError: string \| null = null[\s\S]*?recoveryRes\.success !== true[\s\S]*?BTC Sweeper Recovery Persistence Failure[\s\S]*?BTC broadcast outcome ambiguous/i,
  ],
  [
    'confirmed sweep recovery requires explicit successful status persistence',
    'src/jobs/sweeperWorker.ts',
    /if \(isConfirmed\)[\s\S]*?const \{ data: confirmedRes, error: confirmedErr \} = await supabaseAdmin\.rpc\('update_sweep_operation_status'[\s\S]*?confirmedRes\.success !== true[\s\S]*?Failed to persist confirmed sweep status/i,
  ],
  [
    'P2P escrow integration tests reject hosted Supabase endpoints',
    'tests/p2p-trade-flow.test.ts',
    /isLocalTestUrl[\s\S]*localhost\|127\.0\.0\.1[\s\S]*ALLOW_P2P_INTEGRATION_TESTS[\s\S]*Blocked unsafe P2P integration tests/i,
  ],
  [
    'P2P escrow integration suite returns a failing process status on incomplete assertions',
    'tests/p2p-trade-flow.test.ts',
    /if \(passedTests === totalTests\)[\s\S]*else[\s\S]*process\.exitCode = 1/i,
  ],
  [
    'blockchain deposit test fails when wallet fixture setup fails',
    'tests/blockchain-worker.test.ts',
    /walletSetupError[\s\S]*Unable to create test wallet[\s\S]*assetSetupError[\s\S]*Unable to create test wallet asset[\s\S]*addressSetupError[\s\S]*Unable to register test deposit address/i,
  ],
  [
    'blockchain deposit test checks balance reads and removes its own fixtures',
    'tests/blockchain-worker.test.ts',
    /duplicateBalanceReadError[\s\S]*addressCleanupError[\s\S]*assetCleanupError[\s\S]*walletCleanupError[\s\S]*Test fixture cleanup failed/i,
  ],
  [
    'gas funding recovery surfaces failures persisting RECOVERY_REQUIRED after rebroadcast errors',
    'src/jobs/sweeperWorker.ts',
    /const \{ error: recoveryPersistErr \}[\s\S]*?status: 'RECOVERY_REQUIRED'[\s\S]*?if \(recoveryPersistErr\)[\s\S]*?RECOVERY_REQUIRED status persistence also failed/i,
  ],
  [
    'signed gas funding transaction persistence failure preserves recovery state',
    'src/jobs/sweeperWorker.ts',
    /const signedTxPersistFailure = `Failed to persist signed gas funding transaction:[\s\S]*?signedTxRecoveryPersistErr[\s\S]*?status: 'RECOVERY_REQUIRED'[\s\S]*?RECOVERY_REQUIRED persistence failed/i,
  ],
  [
    'gas funding nonce allocation failure persists RECOVERY_REQUIRED',
    'src/jobs/sweeperWorker.ts',
    /const nonceFailure = `Failed to allocate hot wallet nonce:[\s\S]*?nonceRecoveryPersistErr[\s\S]*?status: 'RECOVERY_REQUIRED'[\s\S]*?RECOVERY_REQUIRED persistence failed/i,
  ],
  [
    'gas funding policy rejection checks FAILED-state persistence',
    'src/jobs/sweeperWorker.ts',
    /const \{ error: rejectionPersistErr \}[\s\S]*?status: 'FAILED'[\s\S]*?FAILED status persistence also failed/i,
  ],
  [
    'hot-wallet insolvency checks RECOVERY_REQUIRED persistence',
    'src/jobs/sweeperWorker.ts',
    /const \{ error: insolvencyPersistErr \}[\s\S]*?status: 'RECOVERY_REQUIRED'[\s\S]*?RECOVERY_REQUIRED persistence failed/i,
  ],
  [
    'EVM gas funding timeout checks recovery-state persistence errors',
    'src/jobs/sweeperWorker.ts',
    /const \{ error: timeoutStatusErr \}[\s\S]*?status: 'RECOVERY_REQUIRED'[\s\S]*?RECOVERY_REQUIRED persistence failed/i,
  ],
  [
    'gas funding recovery checks confirmed-status persistence errors',
    'src/jobs/sweeperWorker.ts',
    /const \{ error: confirmedPersistErr \}[\s\S]*?status: 'CONFIRMED'[\s\S]*?if \(confirmedPersistErr\)[\s\S]*?CONFIRMED status persistence failed/i,
  ],
  [
    'gas funding recovery checks rebroadcast-status persistence errors',
    'src/jobs/sweeperWorker.ts',
    /const \{ error: rebroadcastPersistErr \}[\s\S]*?status: 'BROADCASTED'[\s\S]*?if \(rebroadcastPersistErr\)[\s\S]*?BROADCASTED status persistence failed/i,
  ],
  [
    'reconciliation alert persistence errors are explicitly handled',
    'src/lib/security/reconciliation.ts',
    /const \{ error: alertInsertError \}[\s\S]*?if \(alertInsertError\)[\s\S]*?Error persisting security alert/i,
  ],
  [
    'reconciliation snapshot persistence errors are explicitly handled',
    'src/lib/security/reconciliation.ts',
    /const \{ error: snapshotInsertError \}[\s\S]*?if \(snapshotInsertError\)[\s\S]*?Could not save system_reconciliations snapshot/i,
  ],
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
    'disabled TRON gas funding requires explicit success from recovery-state RPC',
    'src/jobs/sweeperWorker.ts',
    /const disabledReason = 'TRON gas funding is disabled[\s\S]*?update_sweep_operation_status[\s\S]*?p_new_status: 'RECOVERY_REQUIRED'[\s\S]*?recoveryRes\.success !== true[\s\S]*?throw new Error\(disabledReason\)/i,
  ],
  [
    'TRON hot-wallet insolvency checks RECOVERY_REQUIRED persistence errors',
    'src/jobs/sweeperWorker.ts',
    /export async function fundTronGasForAddress[\s\S]*?const insolvMsg = `TRON hot wallet[\s\S]*?insolvencyPersistErr[\s\S]*?status: 'RECOVERY_REQUIRED'[\s\S]*?RECOVERY_REQUIRED persistence failed/i,
  ],
  [
    'BTC and LTC UTXO reservations require explicit RPC success',
    'src/jobs/sweeperWorker.ts',
    /reserve_utxos_for_sweep[\s\S]*?p_network: 'BTC'[\s\S]*?reserveRes\.success !== true[\s\S]*?reserve_utxos_for_sweep[\s\S]*?p_network: 'LTC'[\s\S]*?reserveRes\.success !== true/i,
  ],
  [
    'TRON resource delegation initialization requires explicit RPC success',
    'src/jobs/sweeperWorker.ts',
    /claim_or_initialize_resource_delegation[\s\S]*?if \(initErr \|\| !initRes \|\| initRes\.success !== true\)[\s\S]*?Failed to initialize resource delegation record/i,
  ],
  [
    'TRON delegation signed-transaction persistence requires explicit RPC success',
    'src/jobs/sweeperWorker.ts',
    /persist_signed_delegation[\s\S]*?if \(persistErr \|\| !persistRes \|\| persistRes\.success !== true\)[\s\S]*?Failed to persist signed delegation transaction/i,
  ],
  [
    'TRON gas funding claim rejects malformed responses and requires explicit already-funded true',
    'src/jobs/sweeperWorker.ts',
    /claim_gas_funding_operation[\s\S]*?p_network: 'TRC20'[\s\S]*?typeof claimRes !== 'object' \|\| Array\.isArray\(claimRes\)[\s\S]*?claimRes\.already_funded === true/i,
  ],
  [
    'TRON delegation claim rejects malformed already-delegated flags',
    'src/jobs/sweeperWorker.ts',
    /claim_or_initialize_resource_delegation[\s\S]*?typeof initRes\.already_delegated !== 'boolean'[\s\S]*?if \(initRes\.already_delegated === true\)/i,
  ],
  [
    'gas funding claim only skips when already_funded is explicit true',
    'src/jobs/sweeperWorker.ts',
    /claim_gas_funding_operation[\s\S]*?if \(claimRes\.already_funded === true\)[\s\S]*?already confirmed/i,
  ],
  [
    'pre-broadcast sweep ownership requires explicit valid true',
    'src/jobs/sweeperWorker.ts',
    /verify_sweep_ownership[\s\S]*?if \(error \|\| !verifyRes \|\| verifyRes\.valid !== true\)[\s\S]*?Pre-broadcast ownership check failed/i,
  ],
  [
    'gas funding claim rejects malformed RPC response payloads',
    'src/jobs/sweeperWorker.ts',
    /claim_gas_funding_operation[\s\S]*?if \(claimErr \|\| !claimRes \|\| typeof claimRes !== 'object' \|\| Array\.isArray\(claimRes\)\)[\s\S]*?Gas funding claim RPC failed/i,
  ],
  [
    'TRON gas funding signed-transaction persistence requires explicit RPC success',
    'src/jobs/sweeperWorker.ts',
    /persist_signed_gas_funding[\s\S]*?if \(persistErr \|\| !persistRes \|\| persistRes\.success !== true\)[\s\S]*?Failed to persist signed gas funding transaction/i,
  ],
  [
    'TRON gas funding broadcast requires explicit boolean success',
    'src/jobs/sweeperWorker.ts',
    /Broadcast exact persisted transaction[\s\S]*?const broadcastRes = await tronWeb\.trx\.sendRawTransaction\(signedTx\)[\s\S]*?if \(!broadcastRes \|\| broadcastRes\.result !== true\)[\s\S]*?TRON gas funding broadcast rejected/i,
  ],
  [
    'TRON resource delegation broadcast requires explicit boolean success',
    'src/jobs/sweeperWorker.ts',
    /\/\/ 6\. Broadcast delegation transaction[\s\S]*?const broadcastRes = await tronWeb\.trx\.sendRawTransaction\(signedTx\)[\s\S]*?if \(!broadcastRes \|\| broadcastRes\.result !== true\)[\s\S]*?TRON delegation raw broadcast rejected/i,
  ],
  [
    'TRON token sweep broadcast requires explicit boolean success',
    'src/jobs/sweeperWorker.ts',
    /Pre-broadcast status transition to READY_TO_BROADCAST[\s\S]*?const broadcastRes = await tronWeb\.trx\.sendRawTransaction\(signedTx\)[\s\S]*?if \(!broadcastRes \|\| broadcastRes\.result !== true\)[\s\S]*?TRON raw broadcast rejected/i,
  ],
  [
    'TRON undelegation broadcast requires explicit boolean success',
    'src/jobs/sweeperWorker.ts',
    /Broadcast exact persisted signed transaction bytes[\s\S]*?if \(!broadcastRes \|\| broadcastRes\.result !== true\)[\s\S]*?TRON undelegation raw broadcast rejected/i,
  ],
  [
    'TRON gas broadcast persists transaction hash and checks both broadcast and recovery status writes',
    'src/jobs/sweeperWorker.ts',
    /Broadcast exact persisted transaction[\s\S]*?status: 'BROADCASTED', tx_hash: deterministicTxHash[\s\S]*?broadcastPersistErr[\s\S]*?status: 'RECOVERY_REQUIRED', tx_hash: deterministicTxHash[\s\S]*?recoveryPersistErr/i,
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
  [
    'TRON undelegation remains in recovery unless on-chain resource removal is verified',
    'src/jobs/sweeperWorker.ts',
    /Remaining delegated energy on-chain:[\s\S]*?verifiedDelegationRemoved = false[\s\S]*?Unable to verify delegated resources on-chain; keeping allocation in recovery[\s\S]*?verifiedDelegationRemoved = false/i,
  ],
  [
    'TRON undelegation query fails closed on missing or malformed delegation list',
    'src/jobs/sweeperWorker.ts',
    /!delegatedRes \|\| !Array\.isArray\(delegatedRes\.delegatedResource\)[\s\S]*?missing or malformed delegatedResource list[\s\S]*?ENERGY record without a remaining balance/i,
  ],
  [
    'TRON undelegation refuses malformed persisted transaction or mismatched transaction hash',
    'src/jobs/sweeperWorker.ts',
    /Persisted TRON undelegation transaction is not valid JSON[\s\S]*?signedTx\.txID\.toLowerCase\(\) !== deterministicTxHash\.toLowerCase\(\)[\s\S]*?refusing to broadcast/i,
  ],
  [
    'TRON undelegation validates signed payload before persisting or broadcasting',
    'src/jobs/sweeperWorker.ts',
    /TRON signing returned a malformed signed transaction[\s\S]*?typeof signedTx\.raw_data_hex !== 'string'[\s\S]*?signedTx\.signature\.length === 0/i,
  ],
  [
    'TRON undelegation validates persisted signed payload structure before rebroadcast',
    'src/jobs/sweeperWorker.ts',
    /Persisted TRON undelegation transaction is malformed[\s\S]*?typeof signedTx\.raw_data_hex !== 'string'[\s\S]*?signedTx\.signature\.length === 0/i,
  ],
  [
    'TRON delegation does not report success unless DELEGATED state persistence succeeds',
    'src/jobs/sweeperWorker.ts',
    /Delegation broadcast may have succeeded, but DELEGATED state persistence failed[\s\S]*?delegatedStatusRes\.success !== true[\s\S]*?requires recovery because DELEGATED state was not persisted/i,
  ],
  [
    'TRON delegation validates signed payload before persisting or broadcasting',
    'src/jobs/sweeperWorker.ts',
    /TRON signing returned a malformed delegation transaction[\s\S]*?typeof signedTx\.raw_data_hex !== 'string'[\s\S]*?signedTx\.signature\.length === 0/i,
  ],
  [
    'TRON delegation fails closed when network energy parameters are invalid',
    'src/jobs/sweeperWorker.ts',
    /const totalEnergyLimit = Number\(resources\?\.TotalEnergyLimit\)[\s\S]*?Number\.isSafeInteger\(totalEnergyLimit\)[\s\S]*?refusing estimated delegation/i,
  ],
  [
    'TRON delegation validates receiver address and positive safe energy requirement',
    'src/jobs/sweeperWorker.ts',
    /!tronWeb\.isAddress\(receiverAddress\) \|\| receiverAddress === poolAddress[\s\S]*?Number\.isSafeInteger\(energyNeeded\)[\s\S]*?energy requirement must be a positive safe integer/i,
  ],
  [
    'TRON delegation rejects unsafe intermediate amount calculations',
    'src/jobs/sweeperWorker.ts',
    /Number\.isSafeInteger\(totalEnergyWeightSun\)[\s\S]*?Number\.isSafeInteger\(requiredSunNumerator\)[\s\S]*?Number\.isSafeInteger\(requiredSunNumber\)/i,
  ],
  [
    'ambiguous withdrawal updates require both target rows to be returned',
    'src/jobs/withdrawalWorker.ts',
    /onchainStatusRow[\s\S]*?row not found or not updated[\s\S]*?withdrawalStatusRow[\s\S]*?row not found or not updated/i,
  ],
  [
    'pre-broadcast withdrawal refund requires explicit RPC success',
    'src/jobs/withdrawalWorker.ts',
    /Pre-broadcast validation failure[\s\S]*?refundData\.success !== true/i,
  ],
  [
    'BTC and LTC mempool fees require safe integer values before conversion',
    'src/jobs/withdrawalWorker.ts',
    /Number\.isSafeInteger\(txData\.fee\)[\s\S]*?p_gas_asset: 'BTC'[\s\S]*?Number\.isSafeInteger\(txData\.fee\)[\s\S]*?p_gas_asset: 'LTC'/i,
  ],
  [
    'BTC withdrawal completion requires explicit RPC success',
    'src/jobs/withdrawalWorker.ts',
    /p_gas_asset: 'BTC',[\s\S]*?confData\?\.success !== true/i,
  ],
  [
    'LTC withdrawal completion fails closed without explicit RPC success',
    'src/jobs/withdrawalWorker.ts',
    /p_gas_asset: 'LTC',[\s\S]*?confData\?\.success !== true/i,
  ],
  [
    'verified TRON revert processing requires explicit RPC success',
    'src/jobs/withdrawalWorker.ts',
    /TRON transaction reverted on-chain[\s\S]*?failedData\?\.success !== true/i,
  ],
  [
    'verified EVM revert processing requires explicit RPC success',
    'src/jobs/withdrawalWorker.ts',
    /EVM transaction reverted on-chain[\s\S]*?failedData\?\.success !== true/i,
  ],
  [
    'EVM withdrawal completion requires receipt status exactly successful',
    'src/jobs/withdrawalWorker.ts',
    /confirmations >= chain\.requiredConfirmations && status === 1/i,
  ],
  [
    'TRON withdrawal confirmation poll requires explicit RPC success',
    'src/jobs/withdrawalWorker.ts',
    /p_actual_gas_amount: actualTrxStr,[\s\S]*?confData\?\.success === true/i,
  ],
  [
    'EVM withdrawal confirmation poll requires explicit RPC success',
    'src/jobs/withdrawalWorker.ts',
    /p_actual_gas_amount: actualGasStr,[\s\S]*?confData\?\.success === true/i,
  ],
  [
    'BTC withdrawal confirmation poll requires explicit RPC success',
    'src/jobs/withdrawalWorker.ts',
    /p_gas_asset: 'BTC',[\s\S]*?confData\?\.success !== true/i,
  ],
  [
    'LTC withdrawal confirmation poll requires explicit RPC success',
    'src/jobs/withdrawalWorker.ts',
    /p_gas_asset: 'LTC',[\s\S]*?confData\?\.success !== true/i,
  ],
  [
    'TRON withdrawal completion requires explicit successful RPC result',
    'src/jobs/withdrawalWorker.ts',
    /const { data: completionData, error: completionError } = await supabaseAdmin\.rpc\('complete_onchain_withdrawal'[\s\S]*?completionData\.success !== true/i,
  ],
  [
    'EVM withdrawal completion requires explicit successful RPC result',
    'src/jobs/withdrawalWorker.ts',
    /p_tx_hash: tx\.hash,[\s\S]*?completionData\.success !== true/i,
  ],
  [
    'TRON existing delegated state validates persisted amount before reuse',
    'src/jobs/sweeperWorker.ts',
    /Persisted TRON delegation amount is malformed; refusing to reuse existing delegation[\s\S]*?BigInt\(String\(persistedAmountSun\)\) <= 0n/i,
  ],
  [
    'TRON undelegation fails closed on delegation lookup database errors',
    'src/jobs/sweeperWorker.ts',
    /export async function undelegateEnergyToPool[\s\S]*?if \(fetchErr\) \{\s*throw new Error\(`Failed to load TRON delegation record[\s\S]*?if \(!delegation\)/i,
  ],
  [
    'TRON undelegation requires explicit true from signed-transaction persistence RPC',
    'src/jobs/sweeperWorker.ts',
    /persist_signed_undelegation[\s\S]*?persistRes\.success !== true/i,
  ],
  [
    'TRON undelegation validates pool address before reading delegation records',
    'src/jobs/sweeperWorker.ts',
    /export async function undelegateEnergyToPool[\s\S]*?Failed to resolve a valid TRON pool address from private key[\s\S]*?Retrieve the existing delegation record/i,
  ],
  [
    'TRON undelegation rejects a receiver equal to the pool address',
    'src/jobs/sweeperWorker.ts',
    /export async function undelegateEnergyToPool[\s\S]*?receiverAddress === poolAddress/i,
  ],
  [
    'TRON undelegation duplicate broadcast detection is case-insensitive',
    'src/jobs/sweeperWorker.ts',
    /const normalizedErr = errStr\.toLowerCase\(\)[\s\S]*?!normalizedErr\.includes\('dup'\)[\s\S]*?!normalizedErr\.includes\('already exist'\)/i,
  ],
  [
    'TRON ambiguous delegation broadcast remains in recovery rather than being marked failed',
    'src/jobs/sweeperWorker.ts',
    /Delegation broadcast outcome is ambiguous; preserving operation for reconciliation[\s\S]*?p_new_status: 'RECOVERY_REQUIRED'[\s\S]*?failed to persist RECOVERY_REQUIRED state/i,
  ],
  [
    'TRON reverted undelegation remains unsuccessful when failure-state persistence fails',
    'src/jobs/sweeperWorker.ts',
    /Undelegation transaction reverted on-chain[\s\S]*?failureErr \|\| !failureRes \|\| failureRes\.success !== true[\s\S]*?leaving operation for recovery[\s\S]*?return false/i,
  ],
  [
    'TRON undelegation confirmation requires explicit RPC success',
    'src/jobs/sweeperWorker.ts',
    /confirm_resource_undelegated[\s\S]*?confirmRes\.success !== true/i,
  ],
  [
    'TRON failed undelegation receipt checks persistence result before returning',
    'src/jobs/sweeperWorker.ts',
    /const \{ data: failureRes, error: failureErr \} = await supabaseAdmin\.rpc\('update_delegation_status'[\s\S]*?failureRes\.success !== true[\s\S]*?leaving operation for recovery/i,
  ],

  [
    'password-change withdrawal hold fails closed on database errors',
    'src/lib/withdrawal-security.ts',
    /if \(profileRes\.error\) throw[\s\S]*?if \(settingsRes\.error \|\| !settingsRes\.data\)[\s\S]*?Unable to verify password-change withdrawal hold[\s\S]*?throw err instanceof Error/i,
  ],
  [
    'pending withdrawal approval check fails closed when both lookups fail',
    'src/lib/withdrawal-security.ts',
    /if \(error\)[\s\S]*?primary approval-lock query is authoritative[\s\S]*?Unable to verify pending withdrawal approval state/i,
  ],
  [
    'withdrawal rejects when hold or pending-approval security checks fail',
    'src/lib/services/withdrawalService.ts',
    /let pwdHold:[\s\S]*?checkPasswordChangeHold\(user\.id\)[\s\S]*?hasPendingWithdrawalApproval\(user\.id\)[\s\S]*?Withdrawal hold\/approval security checks unavailable[\s\S]*?statusCode: 503/i,
  ],
  [
    'token withdrawal fee rejects missing USD gas valuation instead of using a fixed fallback',
    'src/lib/fees.ts',
    /Authoritative token network fee USD unavailable[\s\S]*?baseNetworkFeeCrypto = feeUsd/i,
  ],
  [
    'authoritative withdrawal fee rejects unknown networks and zero fees',
    'src/lib/fees.ts',
    /Authoritative network fee unavailable[\s\S]*?Calculated withdrawal fee is invalid/i,
  ],
  [
    'withdrawal asset pricing does not fall back to a fabricated USD price',
    'src/lib/fees.ts',
    /Never invent a USD price[\s\S]*?throw new Error\(\`Authoritative USD price unavailable/i,
  ],
  [
    'withdrawal fee multiplier lookup fails closed when settings are unavailable',
    'src/lib/fees.ts',
    /if \(error \|\| !settings\)[\s\S]*?Withdrawal fee configuration unavailable[\s\S]*?throw err instanceof Error/i,
  ],
  [
    'withdrawal returns 503 when fee or authoritative pricing cannot be resolved',
    'src/lib/services/withdrawalService.ts',
    /Withdrawal pricing\/configuration check unavailable[\s\S]*?status: 'PRICING_UNAVAILABLE'[\s\S]*?statusCode: 503[\s\S]*?Unable to value recent withdrawals[\s\S]*?statusCode: 503/i,
  ],
  [
    'withdrawal rejects when daily withdrawal history cannot be loaded',
    'src/lib/services/withdrawalService.ts',
    /const \{ data: past24hWithdrawals, error: past24hWithdrawalsError \}[\s\S]*?if \(past24hWithdrawalsError \|\| !past24hWithdrawals\)[\s\S]*?status: 'SECURITY_CHECK_UNAVAILABLE'[\s\S]*?statusCode: 503/i,
  ],
  [
    'withdrawal amount strings are parsed strictly instead of with parseFloat',
    'src/lib/services/withdrawalService.ts',
    /const amountText = typeof rawAmount === 'string' \? rawAmount\.trim\(\) : ''[\s\S]*?\^\(\?:\\d\+/,
  ],
  [
    'withdrawal amount validation rejects Infinity and NaN',
    'src/lib/services/withdrawalService.ts',
    /const parsedAmount = [\s\S]*?if \(!Number\.isFinite\(parsedAmount\) \|\| parsedAmount <= 0\)/,
  ],
  [
    'withdrawal reservation RPC failures return service unavailable',
    'src/lib/services/withdrawalService.ts',
    /status: 'RESERVATION_FAILED',[\s\S]*?message: 'Withdrawals are temporarily unavailable\. Please try again later\.',[\s\S]*?statusCode: 503/,
  ],
  [
    'withdrawal RPC errors are not returned verbatim to clients',
    'src/lib/services/withdrawalService.ts',
    /if \(rpcError\)[\s\S]*?error: 'Balance reservation failed\.'[\s\S]*?Withdrawals are temporarily unavailable/i,
  ],
  [
    'withdrawal rejects an unconfirmed reservation RPC result',
    'src/lib/services/withdrawalService.ts',
    /const withdrawalId = rpcResult\?\.withdrawal_id[\s\S]*?RESERVATION_UNCONFIRMED[\s\S]*?statusCode: 503/i,
  ],
  [
    'withdrawal rejects when duplicate-withdrawal lookup fails',
    'src/lib/services/withdrawalService.ts',
    /const \{ data: existing, error: existingError \}[\s\S]*?if \(existingError\)[\s\S]*?Duplicate-withdrawal verification is temporarily unavailable[\s\S]*?statusCode: 503/i,
  ],
  [
    'withdrawal rejects when platform security settings cannot be read',
    'src/lib/services/withdrawalService.ts',
    /const \{ data: settings, error: settingsError \}[\s\S]*?if \(settingsError \|\| !settings\)[\s\S]*?statusCode: 503/i,
  ],
  [
    'withdrawal rejects when account security profile lookup fails or is missing',
    'src/lib/services/withdrawalService.ts',
    /const \{ data: userProfile, error: userProfileError \}[\s\S]*?if \(userProfileError\)[\s\S]*?statusCode: 503[\s\S]*?if \(!userProfile\)[\s\S]*?statusCode: 403/i,
  ],
  [
    'middleware fails closed for API requests when security checks throw',
    'src/middleware.ts',
    /catch \(e\)[\s\S]*?Middleware security check failed[\s\S]*?pathname\.startsWith\('\/api\/'\)[\s\S]*?code: 'SECURITY_CHECK_UNAVAILABLE'[\s\S]*?status: 503/i,
  ],
  [
    'middleware redirects protected pages when security checks throw',
    'src/middleware.ts',
    /const protectedPage = \[[\s\S]*?'\/dashboard'[\s\S]*?'\/wallet'[\s\S]*?'\/withdraw'[\s\S]*?if \(protectedPage\)[\s\S]*?url\.pathname = '\/login'[\s\S]*?security_check_unavailable/i,
  ],
  [
    'sweep reconciliation exception checks recovery-state persistence',
    'src/jobs/sweeperWorker.ts',
    /\[Reconcile Sweep Exception\][\s\S]*?const \{ data: recoveryRes, error: recoveryErr \} = await supabaseAdmin\.rpc\('update_sweep_operation_status'[\s\S]*?p_new_status: 'RECOVERY_REQUIRED'[\s\S]*?recoveryRes\.success !== true[\s\S]*?Reconcile Sweep Critical/i,
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
