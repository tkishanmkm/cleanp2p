import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260928070000_canonical_p2p_state_machine_and_rpcs.sql",
  "utf8",
);

function functionBody(name, nextMarker) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `${name} definition must exist`);
  const end = migration.indexOf(nextMarker, start);
  assert.notEqual(end, -1, `end marker for ${name} must exist`);
  return migration.slice(start, end);
}

const cancel = functionBody("cancel_p2p_trade", "4. Authoritative expire_p2p_trade RPC");
const release = functionBody("release_trade_escrow", "3. Authoritative cancel_p2p_trade RPC");

test("cancel RPC locks the trade before financial mutations and checks caller identity", () => {
  assert.ok(cancel.includes("v_auth_uid UUID := auth.uid();"));
  assert.ok(cancel.includes("p_caller_id IS NOT NULL AND p_caller_id <> v_auth_uid"));
  assert.ok(cancel.includes("FROM public.trades") && cancel.includes("FOR UPDATE"));
  assert.ok(cancel.indexOf("FOR UPDATE") < cancel.indexOf("UPDATE public.wallet_assets"));
  assert.ok(cancel.indexOf("v_effective_caller <> v_trade.buyer_id") < cancel.indexOf("Already cancelled"));
});

test("cancel RPC blocks paid and disputed participant cancellation before refunding escrow", () => {
  assert.ok(cancel.includes("Cannot cancel trade % while a dispute is active."));
  assert.ok(cancel.includes("Cannot cancel trade % after payment has been marked or sent."));
  assert.ok(cancel.indexOf("Cannot cancel trade % after payment has been marked or sent.") < cancel.indexOf("UPDATE public.wallet_assets"));
  assert.ok(cancel.indexOf("UPDATE public.wallet_assets") < cancel.indexOf("INSERT INTO public.ledger_entries"));
  assert.ok(cancel.indexOf("INSERT INTO public.ledger_entries") < cancel.indexOf("UPDATE public.trades"));
});

test("release RPC requires payment and checks terminal states before financial mutations", () => {
  assert.ok(release.includes("cannot be released before payment is marked"));
  assert.ok(release.includes("IN ('cancelled', 'expired')"));
  assert.ok(release.includes("Already released (idempotent success)"));
  assert.ok(release.indexOf("Terminal State & Replay Safety") < release.indexOf("UPDATE public.wallet_assets"));
  assert.ok(release.indexOf("FOR UPDATE") < release.indexOf("UPDATE public.wallet_assets"));
});

test("static test target is the repository migration snapshot, not the installed database", () => {
  assert.ok(migration.includes("CREATE OR REPLACE FUNCTION public.cancel_p2p_trade"));
  assert.ok(migration.includes("CREATE OR REPLACE FUNCTION public.release_trade_escrow"));
});
