import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const migrationDir = resolve(process.argv[2] ?? 'supabase/migrations');
const names = [
  'request_withdrawal',
  'request_withdrawal_idempotent',
  'lookup_withdrawal_idempotency_replay',
  'process_failed_withdrawal',
  'claim_pending_withdrawals',
  'record_withdrawal_broadcast',
  'record_ambiguous_withdrawal_broadcast',
  'approve_withdrawal',
  'admin_reject_withdrawal',
];
const files = readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort();
const events = [];
const functionPattern = /\b(CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|DROP\s+FUNCTION(?:\s+IF\s+EXISTS)?)\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\)/gi;
const aclPattern = /\b(GRANT|REVOKE)\s+(?:ALL|EXECUTE)[\s\S]*?\bON\s+FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\)\s+(?:TO|FROM)\s+([^;]+);/gi;

function compact(value) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

for (const file of files) {
  // Strip SQL comments so disabled historical implementations are not reported as live declarations.
  const sql = readFileSync(join(migrationDir, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');
  for (const match of sql.matchAll(functionPattern)) {
    const [, operation, name, args] = match;
    if (names.includes(name.toLowerCase())) {
      events.push({ file, kind: operation.toUpperCase().replace(/\s+/g, ' '), name: name.toLowerCase(), signature: compact(args) });
    }
  }
  for (const match of sql.matchAll(aclPattern)) {
    const [, operation, name, args, roles] = match;
    if (names.includes(name.toLowerCase())) {
      events.push({ file, kind: operation.toUpperCase(), name: name.toLowerCase(), signature: compact(args), roles: compact(roles) });
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  source: migrationDir,
  limitation: 'Static migration-history inventory only. It does not prove which migrations ran or which overloads/grants exist in a deployed database.',
  eventCount: events.length,
  functions: Object.fromEntries(names.map((name) => [name, events.filter((event) => event.name === name)])),
  events,
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
