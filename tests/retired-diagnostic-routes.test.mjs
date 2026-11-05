import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const diagnosticRoutes = [
  'src/app/api/check-db-records/route.ts',
  'src/app/api/verify-deposit-recovery/route.ts',
];

test('retired diagnostic routes return 404 and contain no hard-coded user/deposit lookups', () => {
  for (const path of diagnosticRoutes) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /status:\s*404/ , `${path} must remain disabled`);
    assert.doesNotMatch(source, /runDepositIngestion|targetTxHash|targetUserId|targetAddress|targetDestination/,
      `${path} must not run recovery or contain hard-coded customer identifiers`);
    assert.doesNotMatch(source, /from\(['"](profiles|ledger_entries|onchain_deposits|deposits|wallets|wallet_assets)['"]\)/,
      `${path} must not query customer/financial records`);
  }
});
