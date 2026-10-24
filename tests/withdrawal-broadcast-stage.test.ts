import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Offline regression guard: deterministic validation must finish before the
// worker enters the ambiguous-broadcast stage. This does not replace mocked
// behavioral tests or controlled staging integration tests.
const source = readFileSync(resolve(process.cwd(), 'src/jobs/withdrawalWorker.ts'), 'utf8');
const legacyProcessor = readFileSync(resolve(process.cwd(), 'src/lib/withdrawal-processor.ts'), 'utf8');
const legacyRoute = readFileSync(resolve(process.cwd(), 'src/app/api/internal/withdrawals/process/route.ts'), 'utf8');
const directWithdrawalRoute = readFileSync(resolve(process.cwd(), 'src/app/api/workers/withdraw/route.ts'), 'utf8');
const legacyEvmDispatchRoute = readFileSync(resolve(process.cwd(), 'src/app/api/withdrawals/dispatch/route.ts'), 'utf8');
const deprecatedScheduler = readFileSync(resolve(process.cwd(), 'src/jobs/scheduler.ts'), 'utf8');
const cronDispatchRoute = readFileSync(resolve(process.cwd(), 'src/app/api/cron/withdrawals/dispatch/route.ts'), 'utf8');
const withdrawalService = readFileSync(resolve(process.cwd(), 'src/lib/services/withdrawalService.ts'), 'utf8');
const withdrawalIdempotencyMigration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261024000002_withdrawal_request_idempotency.sql'), 'utf8');
const tronStart = source.indexOf("// BRANCH A: TRON Network (TRC-20 USDT)");
const evmStart = source.indexOf("// BRANCH B: EVM Networks (ERC20, BEP20)", tronStart);
assert.ok(tronStart >= 0 && evmStart > tronStart, 'TRON and EVM dispatch branches must exist');

const tron = source.slice(tronStart, evmStart);
const tronAmountValidation = tron.indexOf('parseUnitsTron(amountStr, TRON_CONFIG.usdtDecimals)');
const tronContractValidation = tron.indexOf('tronWeb.isAddress(TRON_CONFIG.usdtContract.trim())');
const tronAmbiguousStage = tron.indexOf('isLocalCheckStage = false');
const tronSend = tron.indexOf('await sendTrc20Transfer({');
assert.ok(tronAmountValidation >= 0, 'TRON amount must be parsed before dispatch');
assert.ok(tronContractValidation >= 0, 'configured TRON token contract must be validated');
assert.ok(tronAmountValidation < tronAmbiguousStage, 'TRON amount validation must precede ambiguous stage');
assert.ok(tronContractValidation < tronAmbiguousStage, 'TRON contract validation must precede ambiguous stage');
assert.ok(tronAmbiguousStage < tronSend, 'ambiguous stage must be set before invoking transfer helper');

assert.ok(tron.includes('await markWithdrawalBroadcasted(withdrawal.id, txHash)'), 'TRON tx hash must be persisted before dispatch returns');
assert.ok(tron.includes("status: 'BROADCASTED'"), 'TRON dispatch must return BROADCASTED, not completed');
assert.ok(!tron.includes("rpc('complete_onchain_withdrawal'"), 'TRON dispatch must not settle before confirmation monitoring');

const evm = source.slice(evmStart);
const evmNonce = evm.indexOf('const nonce = await allocateEvmNonce');
const evmFirstSend = evm.indexOf('isLocalCheckStage = false');
assert.ok(evmNonce >= 0 && evmFirstSend > evmNonce, 'EVM nonce allocation must precede broadcast stage');
assert.ok(evm.includes('Withdrawal amount must be greater than zero'), 'EVM zero-amount guard must remain present');
assert.ok(evm.includes('No valid token contract address configured'), 'EVM token contract validation must remain present');

const evmDispatchEnd = evm.indexOf('  } catch (err: any) {');
assert.ok(evmDispatchEnd > 0, 'EVM dispatch catch boundary must exist');
const evmDispatch = evm.slice(0, evmDispatchEnd);
assert.ok(evmDispatch.includes('await markWithdrawalBroadcasted(withdrawal.id, tx.hash)'), 'EVM tx hash must be persisted before dispatch returns');
assert.ok(evmDispatch.includes("status: 'BROADCASTED'"), 'EVM dispatch must return BROADCASTED, not completed');
assert.ok(!evmDispatch.includes("rpc('complete_onchain_withdrawal'"), 'EVM dispatch must not settle before confirmation monitoring');


const tronMonitorGate = source.indexOf('if (isConfirmed && success === false)');
const evmMonitorGate = source.indexOf('confirmations >= chain.requiredConfirmations && status === 0');
assert.ok(tronMonitorGate >= 0, 'TRON refund path must require a confirmed terminal failure');
assert.ok(evmMonitorGate >= 0, 'EVM refund path must require configured confirmations and a reverted receipt');
assert.ok(source.includes("classifyTronReceiptResult(txInfo.receipt?.result)"), 'unknown TRON receipt results must use conservative receipt classification');
assert.ok(source.includes("if (outcome !== 'pending')"), 'TRON confirmation status must remain pending for unknown receipt outcomes');


const tronFailureBlock = source.slice(tronMonitorGate, source.indexOf("} else if (SUPPORTED_EVM_CHAINS[normNet])", tronMonitorGate));
assert.ok(tronFailureBlock.includes("p_is_verified_unbroadcast: true"), 'TRON refund RPC must receive the explicit verified-failure gate');
const evmFailureBlock = source.slice(evmMonitorGate, source.indexOf("} else if (normNet === 'BTC')", evmMonitorGate));
assert.ok(evmFailureBlock.includes("p_is_verified_unbroadcast: true"), 'EVM refund RPC must receive the explicit verified-failure gate');

assert.ok(!legacyProcessor.includes('p_is_verified_unbroadcast: true'), 'legacy processor must never certify an unverified failure as safe to refund');
assert.ok(!legacyProcessor.includes('complete_onchain_withdrawal'), 'legacy processor must not settle withdrawals immediately after broadcast');
assert.ok((legacyProcessor.match(/legacyProcessorDisabled\(\);/g) || []).length >= 6, 'all legacy broadcast entrypoints must fail closed');
assert.ok(legacyRoute.includes("status: 410"), 'legacy internal route must return Gone instead of dispatching withdrawals');
assert.ok(legacyRoute.includes('LEGACY_WITHDRAWAL_PROCESSOR_DISABLED'), 'legacy route must explain why dispatch is disabled');
assert.ok(directWithdrawalRoute.includes('status: 410'), 'direct hot-wallet route must not broadcast or settle withdrawals');
assert.ok(directWithdrawalRoute.includes('LEGACY_DIRECT_WITHDRAWAL_DISABLED'), 'direct hot-wallet route must explain why dispatch is disabled');
assert.ok(legacyEvmDispatchRoute.includes('status: 410'), 'legacy EVM dispatch must not settle before confirmations');
assert.ok(legacyEvmDispatchRoute.includes('LEGACY_EVM_DISPATCH_DISABLED'), 'legacy EVM dispatch must explain why it is disabled');
assert.ok(!deprecatedScheduler.includes("from '../lib/withdrawal-processor'"), 'deprecated scheduler must not import legacy withdrawal processor');
assert.ok(!deprecatedScheduler.includes('processPendingWithdrawals'), 'deprecated scheduler must not schedule legacy withdrawal dispatch');
assert.ok(cronDispatchRoute.includes("import { processWithdrawalQueue } from '@/jobs/withdrawalWorker'"), 'cron dispatch must import the canonical exported queue worker');
assert.ok(cronDispatchRoute.includes('await processWithdrawalQueue()'), 'cron dispatch must invoke the canonical queue worker');
assert.ok(!cronDispatchRoute.includes('processPendingWithdrawals'), 'cron dispatch must not call a missing legacy worker export');
assert.ok(withdrawalService.includes("rpc('request_withdrawal_idempotent'"), 'withdrawal retries must use the atomic idempotency RPC when a key is supplied');
assert.ok(withdrawalService.includes('const validRpcContract = validWithdrawalId'), 'withdrawal service must validate the reservation RPC response contract before reporting success');
assert.ok(withdrawalService.includes("status: 'PLATFORM_CONTROLS_UNAVAILABLE'"), 'withdrawals must fail closed when platform controls cannot be read');
assert.ok(withdrawalService.includes("status: 'PROFILE_VERIFICATION_UNAVAILABLE'"), 'withdrawals must fail closed when account security profile cannot be verified');
assert.ok(withdrawalService.includes("status: 'DAILY_LIMIT_CHECK_UNAVAILABLE'"), 'withdrawals must fail closed when rolling daily withdrawal history cannot be read');
assert.ok(withdrawalService.includes("status: 'RESERVATION_UNCONFIRMED'"), 'invalid reservation responses must fail closed and request reconciliation rather than reporting success');
assert.ok(withdrawalService.includes('Do not submit a new withdrawal request'), 'ambiguous reservation responses must warn callers against unsafe duplicate retries');
assert.ok(withdrawalService.includes('p_idempotency_key: idempotencyKey'), 'withdrawal service must forward the caller idempotency key');
assert.ok(withdrawalService.includes('if (rpcResult?.replayed !== true)'), 'idempotent replays must not create duplicate withdrawal notifications');
assert.ok(withdrawalService.includes('const { error: notificationError } = await supabaseAdmin.from(\'notifications\').insert'), 'withdrawal notification insert errors returned by Supabase must be logged');
assert.ok(!withdrawalService.includes(".eq('destination_address', validDestination)"), 'withdrawal service must not guess idempotency from a matching destination and amount');
assert.ok(withdrawalIdempotencyMigration.includes('pg_advisory_xact_lock'), 'database idempotency must serialize concurrent retries');
assert.ok(withdrawalIdempotencyMigration.includes('different withdrawal request'), 'database must reject reusing a key for a different request payload');
assert.ok(withdrawalIdempotencyMigration.includes('p_usd_equivalent := p_usd_equivalent'), 'idempotent wrapper must preserve authoritative USD approval thresholds');

console.log('Withdrawal broadcast-stage source regression checks passed.');
