import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/webhooks/didit/route.ts', 'utf8');
const migration = readFileSync(
  'supabase/migrations/20261101130000_align_live_didit_webhook_schema_and_event_leases.sql',
  'utf8'
);

assert.match(route, /claim_didit_webhook_event/);
assert.match(route, /finish_didit_webhook_event/);
assert.match(route, /apply_didit_webhook_state/);
assert.match(route, /p_lease_token:\s*eventClaim\.leaseToken/);
assert.match(route, /p_payload_digest:\s*eventClaim\.payloadDigest/);
assert.match(route, /claimResult\.status === 'duplicate'/);
assert.match(route, /claimResult\.status === 'conflict'/);
assert.match(route, /claimResult\.status === 'busy'/);
assert.match(route, /if \(eventClaim\)\s*\{\s*await finishEventClaim\(false\)/);

assert.equal((route.match(/\.from\('profiles'\)\s*\.update\(/g) || []).length, 0,
  'all profile state writes must use the atomic KYC RPC');
assert.equal((route.match(/\.from\('kyc_verifications'\)\s*\.update\(/g) || []).length, 0,
  'all verification state writes must use the atomic KYC RPC');

assert.match(migration, /ADD COLUMN IF NOT EXISTS vendor_data JSONB/i);
assert.match(migration, /ADD COLUMN IF NOT EXISTS decision JSONB/i);
assert.match(migration, /ADD VALUE IF NOT EXISTS 'RESUBMIT_REQUIRED'/i);
assert.match(migration, /ADD VALUE IF NOT EXISTS 'ABANDONED'/i);
assert.match(migration, /CONSTRAINT kyc_webhook_events_session_event_key UNIQUE \(session_id, event_key\)/i);
assert.match(migration, /payload_digest TEXT NOT NULL/);
assert.match(migration, /lease_token UUID/);
assert.match(migration, /FOR UPDATE/);
assert.match(migration, /profile and verification state and finalize the event lease atomically/i);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.apply_didit_webhook_state/i);
assert.match(migration, /p\.didit_session_id = p_session_id OR p\.kyc_vendor_session_id = p_session_id/i);
assert.match(migration, /UPDATE public\.profiles AS p/i);
assert.match(migration, /UPDATE public\.kyc_verifications/i);
assert.match(migration, /UPDATE public\.kyc_webhook_events/i);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.apply_didit_webhook_state/i);
assert.match(migration, /TO service_role/i);

console.log('PASS: Didit source and forward migration encode event leasing and atomic KYC decision persistence.');
console.log('LIMITATION: Requires schema-faithful PostgreSQL replay and provider signature integration verification before deployment.');
