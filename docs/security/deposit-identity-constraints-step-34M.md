# Step 34M — Deposit identity constraints audit

Status: read-only live database audit plus proposal-branch documentation. No SQL, grants, balances, or deployments changed.

## Live index definitions verified

The live Supabase `pg_indexes` query returned:

- `public.deposits`: unique `idx_deposits_canonical` on `lower(trim(tx_hash)), upper(trim(chain)), output_index`.
- `public.onchain_deposits`: unique `idx_onchain_deposits_canonical` on `lower(trim(tx_hash)), upper(trim(network)), output_index`.
- `public.ledger_entries`: unique partial `idx_ledger_entries_deposit_ref` on `reference_id` where `type = 'deposit'` and `reference_id IS NOT NULL`.
- `public.onchain_deposits` also has a non-unique `(tx_hash, network)` index for lookup.

These indexes provide database-level duplicate identity protection for the current keys. They do not establish blockchain authenticity or confirmation truth.

## Live data checks

At audit time, live queries reported:
- `public.deposits`: 0 rows.
- `public.onchain_deposits`: 0 rows.
- `public.ledger_entries`: 0 rows.
- Duplicate normalized deposit identity groups: 0.
- Duplicate normalized on-chain identity groups: 0.
- Duplicate non-null deposit-ledger reference groups: 0.

Because the two deposit tables are empty, these results do not demonstrate that existing production deposits have been reconciled; they indicate no rows were present in these tables during this check. Confirm whether this is the expected project/environment before enabling live deposits.

## Schema drift / migration review note

The repository migration `20260903000000_onchain_deposits_and_worker.sql` initially defines `onchain_deposits.tx_hash TEXT UNIQUE`, whereas the live schema exposes a canonical unique index on normalized transaction hash + network + output index and no standalone unique constraint on `tx_hash`. This is a meaningful difference between historical migration text and live schema. Before preparing any migration, reconcile migration history and actual index/constraint state; do not blindly apply a migration or drop either index.

## What this does and does not fix

- Replay/duplicate identity constraints: present in the live schema for deposits and on-chain deposits, and deposit ledger reference.
- Caller-supplied confirmation trust issue: still unresolved. The credit RPC still derives confirmation status from its `p_confirmations` argument and does not independently validate blockchain evidence/attestation.
- No new index migration is proposed in this step because the live indexes already cover these identity keys.

## Next required step

Design and test a replacement credit boundary that independently validates verifier evidence and atomically credits balances, while preserving the existing uniqueness indexes. Verify environment/data expectations and migration drift before any production change.

No live SQL, permissions, secrets, balances, or deployments were changed.
