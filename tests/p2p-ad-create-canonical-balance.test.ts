import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/api/p2p/ads/route.ts', 'utf8');

test('P2P SELL ads fail closed before any balance read or ad write', () => {
  const guard = source.indexOf("code: 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED'");
  const balanceRead = source.indexOf(".from('wallet_assets')");
  const adInsert = source.indexOf(".from('ads')");
  const mirrorWrite = source.indexOf(".from('p2p_ads')");

  assert.ok(guard >= 0, 'SELL ads must return the stable reservation-unverified error');
  assert.ok(source.indexOf("if (adSide === 'SELL')") < guard, 'guard must be inside the SELL branch');
  assert.ok(source.includes('{ status: 503 }'), 'SELL ad creation must return 503');
  assert.ok(balanceRead < 0 || guard < balanceRead, 'guard must run before wallet balance reads');
  assert.ok(adInsert < 0 || guard < adInsert, 'guard must run before ad insertion');
  assert.ok(mirrorWrite < 0 || guard < mirrorWrite, 'guard must run before p2p_ad mirroring');
});

test('BUY ad path remains available after the SELL guard', () => {
  const guard = source.indexOf("code: 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED'");
  const insert = source.indexOf(".from('ads')");
  assert.ok(guard >= 0 && insert > guard, 'BUY path must continue to the authenticated ads insert');
});
