import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261030140000_harden_escrow_admin_context.sql"),
  "utf8",
);

test("escrow RPC admin checks bind is_admin to an authenticated actor and preserve trusted admin registries", () => {
  assert.match(migration, /public\.release_trade_escrow\(uuid,uuid\)/);
  assert.match(migration, /public\.cancel_p2p_trade\(uuid,uuid,text\)/);
  assert.match(migration, /v_auth_uid IS NOT NULL AND public\.is_admin\(\)/);
  assert.match(migration, /public\.app_admins AS aa WHERE aa\.user_id = v_effective_caller/);
  assert.match(migration, /existing raw_app_meta_data admin predicate is preserved/i);
  assert.match(migration, /v_pattern text := 'v_is_admin[\s\S]*public\\.is_admin/);
  assert.match(migration, /regexp_count\(v_definition, v_pattern\) <> 1/);
  assert.match(migration, /position\('raw_user_meta_data' IN v_definition\) > 0/);
  assert.match(migration, /RAISE EXCEPTION/);
  assert.match(migration, /EXECUTE v_patched/);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
});

test("the current deployed admin-predicate prefix is recognized for both escrow function variants", () => {
  const prefix = /v_is_admin\s*:=\s*public\.is_admin\(\)\s+OR/g;
  const cancelFixture = "v_is_admin := public.is_admin() OR (v_effective_caller IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users WHERE id = v_effective_caller AND ((raw_app_meta_data->>'role') = 'admin')));";
  const releaseFixture = "v_is_admin := public.is_admin() OR EXISTS (SELECT 1 FROM auth.users WHERE id = v_effective_caller AND ((raw_app_meta_data->>'role') = 'admin'));";
  for (const fixture of [cancelFixture, releaseFixture]) {
    assert.equal([...fixture.matchAll(prefix)].length, 1);
    const patched = fixture.replace(
      prefix,
      "v_is_admin := (v_auth_uid IS NOT NULL AND public.is_admin()) OR EXISTS (SELECT 1 FROM public.app_admins AS aa WHERE aa.user_id = v_effective_caller) OR",
    );
    assert.match(patched, /v_auth_uid IS NOT NULL AND public\.is_admin\(\)/);
    assert.match(patched, /public\.app_admins AS aa WHERE aa\.user_id = v_effective_caller/);
    assert.match(patched, /raw_app_meta_data->>'role'/);
    assert.doesNotMatch(patched, /raw_user_meta_data/);
  }
});

test("migration is idempotent only for the reviewed hardened shape and rejects unknown definitions", () => {
  assert.match(migration, /Idempotent success only when the exact authenticated-admin guard exists/);
  assert.match(migration, /Expected exactly one current admin-context predicate/);
  assert.match(migration, /Expected authenticated actor variable is missing/);
  assert.doesNotMatch(migration, /supabase db push|supabase migration up|psql\s/i);
});
