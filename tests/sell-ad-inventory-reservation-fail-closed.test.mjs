import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/api/ads/create/route.ts', 'utf8');
const guard = source.indexOf("code: 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED'");
const walletRead = source.indexOf(".from('wallet_assets')");
const adInsert = source.indexOf(".rpc('create_buy_ad_atomic'");
assert.ok(guard >= 0, 'SELL ad requests must fail closed with a stable error code');
assert.ok(source.includes("{ status: 503 }") , 'unverified inventory reservation must return 503');
assert.ok(walletRead === -1 || guard < walletRead, 'SELL requests must be rejected before the non-atomic balance read');
assert.ok(adInsert >= 0 && guard < adInsert, 'SELL requests must be rejected before inserting an ad');
console.log('PASS: SELL ads fail closed before balance validation and ad insertion');
console.log('NOTE: static contract test only; atomic reservation needs staging integration tests.');
