# Step 30 — Privileged Deposit Function Body Audit

Date: 2026-10-14
Project: Paxones Supabase project eaiwgfxoiwxepinvcykg
Branch: fix/phase-01-fail-closed-deposit-webhooks
Method: read-only PostgreSQL catalog query for function definitions and effective privileges. No financial rows queried. No database writes.

## Executive conclusion

**Critical: several SECURITY DEFINER functions can credit balances using caller-supplied transaction details without independently verifying the blockchain event.** The deployed catalog privilege checks for the inspected functions show service_role=true and anon/authenticated=false. This prevents direct calls from ordinary Supabase API roles in the inspected privilege context, but any server-side code with service_role can invoke them. The main ingestion/webhook paths are fail-closed in the draft, but these functions remain dangerous if reused by another route/job or if the service credential is compromised.

No SQL changes were applied. Do not deploy a grant change or broad function revocation until callers are mapped, as this could break legitimate server-side flows.

## Function-by-function findings

### Critical — `public.ingest_and_credit_deposit(text, integer, text, text, numeric, text, integer)`
- SECURITY DEFINER; service_role can execute; anon/authenticated cannot in the inspected privilege context.
- Accepts transaction hash, log index, network, destination, amount, asset symbol and confirmation count as parameters.
- Resolves an address to a user, but does not independently prove that the exact chain event exists or is canonical.
- Treats `p_confirmations >= 1` as CONFIRMED and then increments wallet balances and profile balances; it can also enqueue a sweep.
- Uses broad exception handlers that can swallow errors around deposit/address and balance/sweep handling. Its conflict handling updates a deposit row by tx hash, which can mask failures and does not bind all identity fields to the same event.
- Must remain unreachable from active credit paths until replaced with verified evidence.

### Critical — `public.credit_onchain_deposit(text, text, numeric, text, text)`
- SECURITY DEFINER; service_role only among inspected API roles.
- Accepts tx hash, address, amount, asset and network and directly inserts a COMPLETED deposit, credits `balances`, and inserts `financial_ledger`.
- Duplicate check uses tx hash alone, not network plus output/log index.
- No proof of canonical transaction, successful receipt, exact output/log index, or confirmations.

### Critical — `public.credit_deposit_atomic(uuid, text, text, text, text, numeric, integer, integer)`
- SECURITY DEFINER; service_role only among inspected API roles.
- Treats caller-supplied `p_confirmations >= p_required_confirmations` as sufficient to credit.
- Accepts user ID, amount, address, txid, network and both confirmation values from the caller.
- Upserts the deposit on txid and can update its confirmation/status fields; then credits `user_wallets` and adds a ledger entry.
- Must not be used as an authoritative on-chain credit boundary.

### Critical — `public.process_incoming_deposit(text, text, text, numeric, text, integer)`
- SECURITY DEFINER; service_role only among inspected API roles.
- Resolves user from address fields in profiles, inserts a deposit and immediately increments `wallet_assets.available_balance` and inserts a ledger entry.
- No chain proof or confirmation parameter/gate exists.
- Idempotency is based on txid/output index; the inserted event is not bound to independently verified asset/network/amount evidence.

### Critical — `public.credit_confirmed_deposit(varchar, integer, varchar, uuid, varchar, numeric)`
- SECURITY DEFINER; service_role only among inspected API roles.
- Accepts user ID and amount and credits `user_wallets.available_balance`.
- Looks for an existing onchain_deposits row and avoids credit only if that row is already COMPLETED; it does not prove that the caller's user/asset/amount match a verified event.
- It updates a matching deposit row to COMPLETED but does not require that such a row was found before crediting. Therefore a missing deposit row can still be followed by a balance credit.

### Critical — `public.process_user_deposit(uuid, text, numeric, text, text, text, text)`
- SECURITY DEFINER; service_role only in the deployed privilege query.
- Validates a set of network labels and a canonical USDT contract for supported EVM/TRON labels, but accepts user ID, address, asset, amount and tx hash from caller.
- Calls `process_deposit_atomic` with `p_confirmations := 100` and output index 0. This can satisfy the confirmation threshold using a fabricated constant rather than chain evidence.
- Must be retired or rewritten to accept verifier-produced evidence only.

### Critical — `public.process_user_deposit(uuid, text, text, numeric, text, text, text)`
- SECURITY DEFINER; service_role only in the deployed privilege query.
- Accepts user ID, asset, amount, tx hash, chain, sender and destination.
- Inserts a deposit as COMPLETED and increments `wallet_assets` without chain verification. Duplicate check by tx hash does not make caller-supplied facts trustworthy.

### Critical — `public.process_user_deposit(uuid, uuid, text, text, numeric, text, text, integer)`
- SECURITY DEFINER; service_role only in the deployed privilege query.
- Accepts user ID, wallet ID, chain, asset, amount, tx hash, address and confirmation count.
- Writes a completed ledger entry and increments balances without checking a verified chain event or validating that the supplied user/wallet/address/asset/amount are all bound to one verified event.

### High — `public.process_confirmed_deposit(uuid)`
- SECURITY DEFINER; service_role only in the deployed privilege query.
- Locks an onchain_deposits row and credits its stored amount when its status is not CONFIRMED, then marks it CONFIRMED.
- Does not itself verify that the stored row was created from independently verified chain evidence. It is safe only if a separately enforced state transition guarantees evidence-backed rows; that guarantee was not established in this audit.

### High — `public.process_user_deposit(uuid, text, text, numeric)` (SECURITY INVOKER)
- This overload is not SECURITY DEFINER and effective API roles cannot execute it in the inspected privilege context, but it still writes a completed transaction and increments wallet balances from supplied fields if called by a sufficiently privileged role.
- Do not assume SECURITY INVOKER alone makes its financial logic safe.

## Privileges and scope

All functions listed above showed `service_role` execution and no `anon`/`authenticated` execution in the catalog query. Prior catalog checks also found no PUBLIC execution for the inspected deposit functions. This audit does not claim to have mapped every SQL trigger, Edge Function, external scheduler, or dynamic RPC call.

## Required remediation (not applied)

1. Keep direct webhook/ingestion/confirmation credit paths disabled until a verified-event design is implemented.
2. Inventory every caller of all functions above, including SQL functions/triggers, Edge Functions, scheduled jobs and all branches/environments.
3. Implement a verifier that independently checks chain/network, successful transaction/receipt, exact output/log index, recipient, asset/token contract, integer base-unit amount, canonical block/reorg status and network-specific finality.
4. Insert verifier-controlled evidence into a restricted table; credit functions must lock and consume one verified evidence row atomically and derive user, amount, asset, destination and confirmation state from that row rather than RPC arguments.
5. Remove the hardcoded `p_confirmations := 100` path and retire legacy functions only after callers are migrated.
6. Test forged amounts, cross-user substitution, wrong contract/network, duplicate event/replay, concurrent credit, failed receipt and reorg in isolated staging; then run tests, typecheck, lint and build.
7. Re-check deployed ACLs and definitions after a reviewed migration.

## Change log
- Audit report only; no production SQL, grants, configuration or financial rows changed.
- No merge or deployment.
- Runtime tests/typecheck/lint/build have not been run.
- Deposits are not production-ready.
