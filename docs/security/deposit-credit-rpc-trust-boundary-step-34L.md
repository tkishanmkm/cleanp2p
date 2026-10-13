# Step 34L — Deposit-credit RPC trust-boundary findings

Status: read-only source audit. This document does not change the live database or alter deposit processing.

## Source inspected

- `supabase/migrations/20261001000000_canonical_process_deposit_atomic_part6k7.sql`
- Blob SHA: `515e1e09e1c85627f09084d7d781f7822abe63da`
- Live permission evidence from Step 34H: `anon` and `authenticated` cannot execute the 11-argument overload; `service_role` can execute it and can read Vault secret views.

## Confirmed high-severity issue

The RPC accepts `p_confirmations` as an ordinary input and calculates:

```sql
v_effective_confirmations := GREATEST(
  COALESCE(p_confirmations, 0),
  COALESCE(v_existing_onchain.confirmations, 0)
);
v_is_confirmed := (v_effective_confirmations >= v_required_confirmations);
```

The function then uses `v_is_confirmed` to decide whether to credit `wallet_assets`. It does not independently verify blockchain evidence or a signed attestation inside the database function. Since `service_role` can execute it, a compromised handler or leaked service-role key can supply a confirmation count and invoke the credit path. Address, network, contract, state, and ledger checks do not prove the claimed chain transaction occurred.

## Replay / concurrency observations

- The function uses a transaction-scoped advisory lock over network, transaction hash, and output index.
- It checks existing rows in `deposits` and `onchain_deposits`, then checks for a ledger entry before updating the balance.
- The inspected function migration itself does not declare a unique index and does not use `ON CONFLICT` for these identity keys. This does not prove the live schema lacks constraints; all migrations and live indexes must be checked before deciding whether a new unique index is safe.
- The advisory lock plus application-level checks are not a substitute for database-enforced unique constraints. Ledger uniqueness and historical duplicates must be audited before adding constraints.

## Required safe implementation direction

1. Do not accept caller-supplied confirmations as proof of finality.
2. Move the credit decision behind a database-validated attestation or another reviewed trust boundary that ordinary `service_role` cannot forge.
3. Do not put an HMAC secret in Vault while `service_role` can read Vault secret views.
4. Enforce unique network + transaction hash + output/log index at the database layer after auditing and reconciling existing rows.
5. Enforce unique ledger reference semantics and perform credit, deposit state changes, and replay consumption in one transaction.
6. Test forged confirmation counts, forged signatures, duplicate requests, parallel races, mismatched owner/destination/asset/amount, insufficient confirmations, rollback, and legitimate pending-to-credited flows in staging.

## Safety decision

Do not revoke `service_role` EXECUTE until a replacement ingestion/credit path is implemented and verified; doing so may halt legitimate deposit crediting. Do not deploy or merge this proposal as production-ready based on this audit alone.

No live SQL, grants, secrets, deployments, or balances were changed.
