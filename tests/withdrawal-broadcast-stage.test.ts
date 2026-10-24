import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Offline regression guard: deterministic validation must finish before the
// worker enters the ambiguous-broadcast stage. This does not replace mocked
// behavioral tests or controlled staging integration tests.
const source = readFileSync(resolve(process.cwd(), 'src/jobs/withdrawalWorker.ts'), 'utf8');
const legacyProcessor = readFileSync(resolve(process.cwd(), 'src/lib/withdrawal-processor.ts'), 'utf8');
const legacyRoute = readFileSync(resolve(process.cwd(), 'src/app/api/internal/withdrawals/process/route.ts'), 'utf8');
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

assert.ok(!legacyProcessor.includes('p_is_verified_unbroadcast: true'), 'legacy processor must never certify a broadcast error as unbroadcast');
assert.ok(legacyProcessor.includes('Repeated broadcast failure; outcome unverified:'), 'legacy retry exhaustion must label broadcast outcome unverified');
assert.ok(legacyProcessor.includes('typeof failureResult.success !== \'boolean\''), 'legacy processor must validate the failure RPC response');
assert.ok(legacyProcessor.includes('Withdrawal remains reserved pending reconciliation'), 'legacy retry exhaustion must keep reconciliation outcomes visible');
assert.ok(!legacyProcessor.includes('complete_onchain_withdrawal'), 'legacy processor must not settle withdrawals immediately after broadcast');
assert.ok((legacyProcessor.match(/assertLegacyWithdrawalProcessorDisabled\(\);/g) || []).length >= 6, 'all legacy broadcast entrypoints must fail closed');
assert.ok(legacyRoute.includes("status: 410"), 'legacy internal route must return Gone instead of dispatching withdrawals');
assert.ok(legacyRoute.includes('LEGACY_WITHDRAWAL_PROCESSOR_DISABLED'), 'legacy route must explain why dispatch is disabled');

console.log('Withdrawal broadcast-stage source regression checks passed.');
