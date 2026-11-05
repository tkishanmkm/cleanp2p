import { createClient } from '@supabase/supabase-js';

/**
 * Guardrail for integration tests that mutate financial rows or call financial RPCs.
 * These tests must run only against a disposable test database, never production.
 * Configure PAXONES_TEST_SUPABASE_URL, PAXONES_TEST_SUPABASE_SERVICE_ROLE_KEY,
 * and PAXONES_TEST_DB_ALLOW_MUTATIONS=1 explicitly for that isolated environment.
 */
const supabaseUrl = process.env.PAXONES_TEST_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.PAXONES_TEST_SUPABASE_SERVICE_ROLE_KEY?.trim();
const allowMutations = process.env.PAXONES_TEST_DB_ALLOW_MUTATIONS === '1';

if (!supabaseUrl || !serviceRoleKey || !allowMutations) {
  throw new Error(
    'Financial integration tests are blocked. Configure PAXONES_TEST_SUPABASE_URL, ' +
      'PAXONES_TEST_SUPABASE_SERVICE_ROLE_KEY, and PAXONES_TEST_DB_ALLOW_MUTATIONS=1 ' +
      'for a disposable test database. Do not use production credentials.'
  );
}

let hostname: string;
try {
  hostname = new URL(supabaseUrl).hostname.toLowerCase();
} catch {
  throw new Error('PAXONES_TEST_SUPABASE_URL must be a valid absolute URL.');
}

if (hostname.includes('eaiwgfxoiwxepinvcykg')) {
  throw new Error('Refusing to run mutating integration tests against the Paxones production Supabase project.');
}

if (hostname === 'placeholder.supabase.co' || serviceRoleKey === 'placeholder-key') {
  throw new Error('Refusing to run integration tests with placeholder Supabase configuration.');
}

export const testSupabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
