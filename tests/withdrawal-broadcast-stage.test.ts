import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Offline regression guard: deterministic validation must finish before the
// worker enters the ambiguous-broadcast stage. This does not replace mocked
// behavioral tests or controlled staging integration tests.
const source = readFileSync(resolve(process.cwd(), 'src/jobs/withdrawalWorker.ts'), 'utf8');
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

const evm = source.slice(evmStart);
const evmNonce = evm.indexOf('const nonce = await allocateEvmNonce');
const evmFirstSend = evm.indexOf('isLocalCheckStage = false');
assert.ok(evmNonce >= 0 && evmFirstSend > evmNonce, 'EVM nonce allocation must precede broadcast stage');
assert.ok(evm.includes('Withdrawal amount must be greater than zero'), 'EVM zero-amount guard must remain present');
assert.ok(evm.includes('No valid token contract address configured'), 'EVM token contract validation must remain present');

console.log('Withdrawal broadcast-stage source regression checks passed (10 assertions).');
