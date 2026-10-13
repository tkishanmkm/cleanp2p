# Step 35A — Live financial RPC execute-permission audit

## Scope and method
Read-only catalog inspection of production project `eaiwgfxoiwxepinvcykg`. For wallet/deposit/withdrawal/sweep routines, queried function identity arguments, SECURITY DEFINER status, configured search_path, and effective EXECUTE privileges for `anon`, `authenticated`, and `service_role`. No RPC was invoked and no privilege/schema change was made.

## Verified result
For the 40+ matching financial routines returned by the catalog query, `anon` and `authenticated` had no EXECUTE privilege. This is positive for the public API boundary but does not isolate the service-role trust boundary.

The following SECURITY DEFINER deposit-crediting routines are executable by `service_role` and accept transaction/amount/confirmation inputs (their names/signatures are not proof that each is currently called):
- `process_deposit_atomic(p_destination_address text, p_asset_symbol text, p_network_code text, p_amount numeric, p_tx_hash text, p_output_index integer, p_block_number bigint, p_from_address text, p_token_contract text, p_confirmations integer, p_provider text)`
- `credit_deposit_atomic(p_user_id uuid, p_crypto text, p_network text, p_address text, p_txid text, p_amount numeric, p_confirmations integer, p_required_confirmations integer)`
- `ingest_and_credit_deposit(p_tx_hash text, p_log_index integer, p_network text, p_to_address text, p_amount numeric, p_asset_symbol text, p_confirmations integer)`
- `process_user_deposit` has four overloads; three are SECURITY DEFINER and service-role executable.
- `credit_confirmed_deposit`, `credit_onchain_deposit`, `process_deposit`, and `process_incoming_deposit` are also service-role executable SECURITY DEFINER routines.

This establishes a **privileged RPC inventory**, not that every function is exploitable or unused. The exact bodies, current call sites, state effects, and deprecation status must be reviewed before revoking or disabling anything. The service-role credential itself is privileged; restricting anon/authenticated does not prevent a compromised service-role holder from calling these routines.

## Search-path observations
Several legacy SECURITY DEFINER routines show an empty/quoted-empty search_path setting rather than an explicit safe path. Others pin `public, pg_temp` or `public, auth, pg_temp`. The legacy routines with unset/empty search_path require per-function body review for schema-qualified references and object-resolution risks before remediation. Do not blanket-change all financial routines without compatibility tests.

## Required next action
1. Trace every RPC to source-code call sites and worker routes, including archived/obsolete paths.
2. For each crediting routine, document balance/ledger side effects, idempotency keys, caller inputs, and whether chain evidence is independently verified.
3. Identify a single supported deposit-credit path and replace or safely retire redundant paths only after call-site and rollback review.
4. Test with forged confirmations, arbitrary amounts/destinations, duplicate identities, concurrent requests, invalid provider evidence, and service-role invocation.
5. Apply any grant changes as a reviewed migration to staging first, then re-query effective privileges and run integration tests.

## Status
No live database changes were made. Deposit production readiness remains **NOT READY** because the canonical RPC uses caller-influenced confirmations and legacy crediting RPCs remain in the privileged service-role surface. Do not merge/deploy endpoint-retirement branches before a replacement deposit path and operational continuity plan are validated.
