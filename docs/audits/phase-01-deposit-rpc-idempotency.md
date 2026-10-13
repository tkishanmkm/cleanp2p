# Deposit RPC / idempotency audit — Phase 01 Step 6

**Scope:** Read-only review of the deployed `public.process_deposit_atomic` definition, its execution grants, relevant unique indexes, and the repository's canonical migration. No row data was queried and no database changes were made.

## Findings

### Critical: deployed RPC does not enforce immutable identity on existing pending deposits

The deployed function's definition does not contain comparisons that reject a repeat callback when an existing `deposits` or `onchain_deposits` row has a different `user_id` or `amount` from the new callback. It does look up existing rows by normalized transaction hash, network, and output index and takes row locks, but those locks alone do not enforce identity immutability.

**Risk:** A repeated/malformed callback for an already-pending transaction/output could attempt to change the amount or resolve a different destination owner before crediting. The function must fail closed when any immutable transaction identity attribute differs. This is a code-path risk from function inspection, not a claim that exploitation has occurred.

### High: confirmation count is supplied by the caller

The deployed function calculates effective confirmations using `p_confirmations` and existing on-chain record data, then compares it with a network threshold. It does not independently verify canonical chain state inside the function. The webhook route supplies provider-reported confirmations.

**Risk:** The RPC's threshold check is not proof of chain finality. This boundary depends on webhook authentication, the provider/gateway contract, and independent chain verification or a trusted internal confirmation worker.

### High: deployed and repository confirmation policy differ

The deployed function sets Litecoin's required confirmation count to **6**. The current repository migration `20261001000000_canonical_process_deposit_atomic_part6k7.sql` sets Litecoin's required confirmation count to **12**. The source migration and deployed database therefore do not currently describe the same policy.

### Positive controls observed

- The deployed RPC is `SECURITY DEFINER`, owned by `postgres`, and sets `search_path` to `public, pg_temp`.
- The observed execute grants are `postgres`, `service_role`, and `supabase_auth_admin`; no `anon` or `authenticated` execute grant appeared in the routine privilege query.
- `deposits` has a unique canonical index on normalized transaction hash, chain, and output index.
- `onchain_deposits` has a unique canonical index on normalized transaction hash, network, and output index.
- `ledger_entries` has a partial unique index on `reference_id` for deposit-type entries.
- The RPC uses an advisory transaction lock keyed by network, transaction hash, and output index.

These controls help with concurrent duplicate processing, but they do not replace immutable-field checks or chain verification.

## Why this step does not include a SQL fix

The deployed RPC is materially different from the latest repository migration, and production table contracts have already been found to differ from repository migrations. Replacing the function from source without a deliberate contract reconciliation could break deposits or accounting. This PR documents the confirmed gap; it does not change SQL or production.

## Required remediation sequence

1. Reconcile the deployed function and schema against the intended canonical migration without changing production.
2. Prepare a reviewed replacement function that fails closed on mismatched user, amount, asset, network, destination, output index, and split-state inconsistencies before any balance mutation.
3. Define a trusted confirmation source and explicit Litecoin confirmation policy; do not treat a callback field alone as canonical chain proof.
4. Verify the unique constraints and ledger idempotency behavior against the actual production schema.
5. Test using synthetic/local fixtures and read-only schema checks. No live coin tests.
6. Apply only after explicit approval, a tested rollback plan, and staging validation.

## Verification performed

- Read-only production catalog query for the deployed function signature, owner, security-definer flag, and search path.
- Read-only inspection of function source for immutable user/amount comparisons and confirmation logic.
- Read-only query of execute privileges.
- Read-only query of relevant unique indexes.
- Compared deployed confirmation threshold with the repository migration.

No production data rows were read or modified. No migration was executed. No merge or deployment was performed.
