import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const action = readFileSync('src/app/ad/actions.ts', 'utf8');
const modal = readFileSync('src/components/p2p/trade-initiation-modal.tsx', 'utf8');

assert.match(action, /if \(!ad\)[\s\S]*?AD_NOT_FOUND/);
assert.doesNotMatch(action, /user_id:\s*'trader_verified_1'/);
assert.doesNotMatch(action, /price:\s*64250|80116\.02|VerifiedTrader/);
assert.doesNotMatch(action, /fetchUserCryptoBalance/);
assert.match(action, /AD_PAYMENT_METHODS_MISSING/);
assert.match(action, /sellerStats: \{[\s\S]*?totalTrades,/);
assert.match(action, /totalTrades,[\s\S]*?completedTrades,/);
assert.doesNotMatch(action, /totalTrades \|\| 10|completedTrades \|\| 10|feedback_score \|\| 99|avg_release_minutes \|\| 3\.5/);
assert.match(modal, /availablePaymentMethods\.length === 0/);
assert.match(modal, /no configured payment methods/);
assert.doesNotMatch(modal, /\["Bank Transfer"\]/);
assert.doesNotMatch(modal, /\|\| "Bank Transfer"/);
assert.match(modal, /usePlatformFeeSettings/);

console.log('PASS: ad details and trade initiation use persisted ad/profile data, reject unconfigured payment methods, and do not fabricate seller or performance metrics.');