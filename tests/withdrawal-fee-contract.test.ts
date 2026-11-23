import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const fees = read("src/lib/fees.ts");
const gasOracle = read("src/lib/gas-oracle.ts");
const withdrawalService = read("src/lib/services/withdrawalService.ts");
const dialog = read("src/components/wallets/withdraw-dialog.tsx");
const sweeper = read("src/jobs/sweeperWorker.ts");

assert.match(fees, /updated_at/);
assert.match(fees, /ageMs <= 10 \* 60_000/);
assert.match(fees, /baseNetworkFeeCrypto = feeUsd \/ 2\.0/);
assert.match(fees, /baseNetworkFeeCrypto = gasMetric\.estimated_fee_native \/ 2\.0/);
assert.match(fees, /feeCrypto = Number\(\(baseNetworkFeeCrypto \* multiplier\)/);

assert.match(gasOracle, /ageMs <= 10 \* 60_000/);
assert.match(gasOracle, /ageMs <= 2 \* 60_000/);
assert.match(gasOracle, /Dynamic on-demand fallback calculation/);

assert.match(withdrawalService, /MIN_WITHDRAWAL_USD_NOT_MET/);
assert.match(withdrawalService, /usdEquivalent < 5/);
assert.match(withdrawalService, /is_restricted, is_suspended/);
assert.match(withdrawalService, /userProfile\.is_restricted === true/);
assert.doesNotMatch(withdrawalService, /account_status: 'restricted'/);

assert.match(dialog, /withdrawAmt \* liveAssetPrice < 5/);
assert.match(dialog, /t\('withdrawDialog\.minimumWithdrawalNotMet'\)/);

assert.match(sweeper, /MIN_SWEEP_VALUE_USD = 5\.0/);
assert.match(sweeper, /meetsMinimumSweepUsdValue\('USDT', balanceUsdt\)/);
assert.match(sweeper, /meetsMinimumSweepUsdValue\('BTC', totalBtc\)/);
assert.match(sweeper, /meetsMinimumSweepUsdValue\('LTC', totalLtc\)/);
assert.match(sweeper, /meetsMinimumSweepUsdValue\('ETH', balanceEth\)/);
assert.match(sweeper, /requireEvmHotWalletAddress/);
assert.match(sweeper, /requireBitcoinHotWalletAddress/);
assert.match(sweeper, /requireLitecoinHotWalletAddress/);
assert.doesNotMatch(sweeper, /0x0000000000000000000000000000000000000000/);
assert.doesNotMatch(sweeper, /bc1q00000000000000000000000000000000000000/);
assert.doesNotMatch(sweeper, /ltc1q00000000000000000000000000000000000000/);

const migration = read("supabase/migrations/20261026120000_harden_withdrawal_rpc_restrictions_and_minimum.sql");
assert.match(migration, /request_withdrawal/);
assert.match(migration, /v_is_restricted OR v_is_suspended/);
assert.match(migration, /MIN_WITHDRAWAL_USD_NOT_MET/);
assert.match(migration, /SET is_restricted = true, status = ''restricted''/);
assert.match(migration, /SET search_path =/);

console.log("PASS: withdrawal minimum, price freshness, single 2x multiplier, sweep minimum, and hot-wallet fail-closed contracts");
console.log("NOTE: these are static checks; production RPC migration remains unapplied pending migration-chain reconciliation.");
