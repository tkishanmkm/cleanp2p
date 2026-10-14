# Step 36Z — Generic balance credit and platform-ledger RPC audit

Date: 2026-10-14  
Project: production Supabase `eaiwgfxoiwxepinvcykg` (`paxonesflows`)  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Scope: read-only inspection of live function definitions, EXECUTE ACLs, and source-caller search. No financial RPC was executed and no data/schema/privilege was changed.

## 1. Critical finding: `credit_user_balance` can mint an unverified credit if called

Live signature:
`public.credit_user_balance(target_user_id uuid, target_asset text, target_network text, credit_amount numeric) RETURNS numeric`

Live security:
- `SECURITY DEFINER`
- `search_path = ''` (empty/pinned; function references are schema-qualified)
- EXECUTE denied to `anon` and `authenticated`
- EXECUTE granted to `service_role`

Observed function body:
- Ensures a `public.wallets` parent row exists.
- Upserts `public.wallet_assets`, adding caller-supplied `credit_amount` to `available`.
- Inserts a `deposit` row into `public.ledger_entries`.
- Returns the resulting available balance.

Critical missing controls in this function body:
- It does not verify an on-chain transaction, chain/network evidence, confirmation depth, destination ownership, transaction output uniqueness, or deposit status.
- It does not require a deposit ID, tx hash, output index, provider evidence, or idempotency key.
- It does not validate `credit_amount > 0` or enforce a bounded numeric precision in the function body.
- It does not create a platform-ledger counterpart.
- Its ledger insert omits `reference_id`, so the partial unique deposit-reference index cannot protect repeated calls.

Therefore, any trusted service-role caller that can invoke this function with arbitrary inputs could increase a user's available balance without verified deposit evidence and could repeat the credit. Current role ACL containment prevents ordinary anon/authenticated invocation, but it does not make the function safe as a service-role capability. This is a **critical privileged-call boundary**, not evidence that an exploit has occurred.

## 2. `record_platform_ledger_entry` is not a user-balance credit function

Live signature:
`public.record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb) RETURNS uuid`

Live security:
- `SECURITY DEFINER`, `search_path = public, pg_temp`
- EXECUTE denied to `anon` and `authenticated`
- EXECUTE granted to `service_role`

Positive controls:
- Requires a non-empty idempotency key and entry type.
- Requires asset code and positive amount.
- Restricts direction to `CREDIT` or `DEBIT`.
- Inserts into the separate `platform_ledger_entries` table.
- Uses unique-key conflict handling and compares core event fields on replay, raising an exception if the same key is reused for a different event.

Important limitation:
- This function records a platform-ledger entry only; the inspected body does not itself update user wallet balances or prove chain evidence. A correct idempotent platform entry is not proof that a matching user credit or external chain event occurred.
- The replay comparison does not compare `metadata`; determine whether metadata is audit-only or part of event identity before relying on it as a full payload fingerprint.

## 3. Caller inventory limitation

Repository code search for both exact function names returned no indexed results on the GitHub search connector. This is **not proof there are no callers**: earlier audits established that this connector can miss repository symbols. The caller inventory therefore remains unverified. Before any privilege restoration or production-ready sign-off, search the checked-out source, migrations, Edge Functions, scheduled jobs, and all service-role paths for these function names and indirect wrappers.

## 4. Recommended disposition

1. Keep `credit_user_balance` unavailable to ordinary clients and do not call it from deposit ingestion. Prefer revoking its `service_role` EXECUTE grant once a complete caller inventory confirms it is not needed by a legitimate safe workflow. Do not revoke blindly before identifying dependencies.
2. Replace generic credits with a narrowly scoped, verified deposit-credit transaction that binds a canonical deposit/output identity, confirmed evidence, destination ownership, amount/asset/network, and idempotency key; it must update the authoritative balance and ledger atomically.
3. Keep `record_platform_ledger_entry` limited to trusted accounting services; verify every caller and reconcile its entries with corresponding user-level accounting events.
4. Coordinate the ledger migration across deposit, withdrawal reservation, withdrawal settlement/refund, transfer, escrow/trade, reconciliation, and history consumers. Do not patch only the failing withdrawal columns or loosen constraints in isolation.
5. Stage-test duplicate deposits, changed-payload idempotency conflicts, unconfirmed/reverted chain events, wrong destination, wrong network/asset, negative/zero/over-precision amount, and rollback on ledger insert failure.

## 5. Verification / limitations

- Read live definitions, signatures, SECURITY DEFINER flags, search_path settings, and role EXECUTE privileges.
- Attempted exact-name repository searches; connector returned no indexed matches, so no caller absence claim is made.
- No RPC was executed; no user balance, ledger row, transfer, withdrawal, or deposit was changed.
- No privileges were changed, no migration applied, and no build/typecheck/tests were run.

## Result

The generic `credit_user_balance` function is a critical unsafe capability if used as a verified-deposit credit path. Privilege containment currently limits who can call it, but its callers remain to be inventoried. This step is audit-only and does not resolve the identified issue.
