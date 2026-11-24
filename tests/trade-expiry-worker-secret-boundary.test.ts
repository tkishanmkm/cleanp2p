import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(
  join(process.cwd(), 'src/app/api/cron/expire-trades/route.ts'),
  'utf8',
);
const envExample = readFileSync(join(process.cwd(), '.env.example'), 'utf8');

test('trade expiry accepts cron or its own dedicated worker secret only', () => {
  const allowedSecrets = route.match(/allowedSecrets:\s*\[([\s\S]*?)\]/)?.[1] ?? '';

  assert.ok(allowedSecrets.includes('CRON_SECRET_KEY'));
  assert.ok(allowedSecrets.includes('CRON_SECRET'));
  assert.ok(allowedSecrets.includes('WAYONES_P2P_EXPIRY_WORKER_SECRET'));
  assert.ok(!allowedSecrets.includes('DEPOSIT_WORKER_SECRET'));
});

test('the dedicated trade-expiry secret is documented separately from deposit credentials', () => {
  assert.match(
    envExample,
    /# Optional trade-expiry credential; keep separate from DEPOSIT_WORKER_SECRET\.\r?\nWAYONES_P2P_EXPIRY_WORKER_SECRET=/,
  );
});
