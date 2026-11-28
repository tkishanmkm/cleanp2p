import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const roots = ['src/app/api', 'src/jobs', 'src/worker.ts', 'src/lib'];
const targetNames = new Set([
  'request_withdrawal', 'request_withdrawal_idempotent', 'lookup_withdrawal_idempotency_replay',
  'get_withdrawal_idempotency_replay', 'process_failed_withdrawal', 'claim_pending_withdrawals',
  'record_withdrawal_broadcast', 'record_onchain_withdrawal_broadcast',
  'record_ambiguous_withdrawal_broadcast', 'mark_withdrawal_ambiguous_broadcast',
  'approve_withdrawal', 'admin_reject_withdrawal', 'reject_withdrawal_pending_approval',
  'acquire_withdrawal_worker_lease', 'renew_withdrawal_worker_lease', 'release_withdrawal_worker_lease',
]);
const files = [];
function walk(path) {
  let stat;
  try { stat = statSync(path); } catch { return; }
  if (stat.isFile()) {
    if (/\.(ts|tsx|js|mjs|cjs)$/.test(path)) files.push(path);
    return;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    walk(join(path, entry.name));
  }
}
for (const item of roots) walk(join(root, item));
const calls = [];
const pattern = /\.rpc\s*\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*,\s*\{([\s\S]*?)\}\s*\)/gi;
for (const file of [...new Set(files)]) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!targetNames.has(name)) continue;
    const argsText = match[2];
    const args = [...argsText.matchAll(/\b([a-z_][a-z0-9_]*)\s*:/gi)].map((m) => m[1]);
    const line = source.slice(0, match.index).split('\n').length;
    calls.push({ file: relative(root, file).replaceAll('\\', '/'), line, rpc: name, argumentKeys: args });
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  source: root,
  limitation: 'Static source call-site inventory. It does not establish deployed PostgreSQL signatures, overload resolution, role grants, or runtime reachability.',
  callCount: calls.length,
  calls,
  missingCallSites: [...targetNames].filter((name) => !calls.some((call) => call.rpc === name)),
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
