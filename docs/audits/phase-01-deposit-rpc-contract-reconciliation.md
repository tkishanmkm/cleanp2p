# Deposit RPC contract reconciliation — Phase 01 Step 8

**Status:** Read-only contract comparison. This is not a replacement migration and does not change production.

## Confirmed deployed contract

Production function:
- Signature: `process_deposit_atomic(p_destination_address text, p_asset_symbol text, p_network_code text, p_amount numeric, p_tx_hash text, p_output_index integer DEFAULT 0, p_block_number bigint DEFAULT NULL, p_from_address text DEFAULT NULL, p_token_contract text DEFAULT NULL, p_confirmations integer DEFAULT 0, p_provider text DEFAULT 'internal')`
- Return type: `jsonb`
- `SECURITY DEFINER`, owner `postgres`, search path `public, pg_temp`.
- Routine execute grants observed: `postgres`, `service_role`, `supabase_auth_admin`; no direct `anon` or `authenticated` execute grant observed.

The repository migration `20261001000000_canonical_process_deposit_atomic_part6k7.sql` defines the same argument list and JSONB return type, but the deployed function body is not the same as the repository migration body.

## Production tables and relevant constraints observed

The following columns exist in production and are used by the current canonical migration:
- `deposits`: `user_id`, `chain`, `token_symbol`, `tx_hash`, `amount`, `from_address`, `to_address`, `status`, `block_number`, `asset`, `output_index`.
- `onchain_deposits`: `user_id`, `tx_hash`, `network`, `address`, `amount`, `asset_symbol`, `confirmations`, `required_confirmations`, `status`, `to_address`, `asset`, `asset_code`, `network_code`, `output_index`.
- `wallet_assets`: `id`, `user_id`, `asset_symbol`, `balance`, `updated_at`.
- `user_deposit_addresses`: `user_id`, `network`, `address`, plus asset/network code fields.
- `ledger_entries`: `user_id`, `crypto`, `amount`, `type`, `reference_id`, `balance_after`, `metadata`, `asset`, `chain`, `status`.

Relevant unique indexes exist:
- `deposits(lower(trim(tx_hash)), upper(trim(chain)), output_index)`
- `onchain_deposits(lower(trim(tx_hash)), upper(trim(network)), output_index)`
- `ledger_entries(reference_id)` where `type = 'deposit'` and `reference_id IS NOT NULL`.

These are useful idempotency controls but do not prove the function body enforces all immutable fields or verifies canonical chain state.

## Material behavior divergence

The deployed function has a network rule requiring **6 Litecoin confirmations**. The repository migration requires **12 Litecoin confirmations**. The migration also contains explicit null-safe comparisons for existing deposit/on-chain user and amount fields and split-record consistency checks; these exact checks were not found in the deployed function body.

The deployed function uses caller-supplied `p_confirmations`, so its confirmation threshold does not independently establish chain finality.

## Remediation decision

Do not blindly apply the repository migration to production. Although the signature and many referenced columns align, the function bodies differ and the policy divergence affects when balances are credited.

Before preparing a replacement:
1. Decide and document the required confirmation policy for each supported network.
2. Review the entire deployed function against the canonical migration, including address-to-user resolution, token contract checks, wallet provisioning/status checks, balance mutation, ledger insertion, status transitions, and exception handling.
3. Build a candidate migration that preserves the verified deployed signature and actual table contract.
4. Test on isolated staging with synthetic fixtures, duplicate replay, concurrency, and write-failure injection.
5. Review grants, search path, and SECURITY DEFINER safety.
6. Obtain explicit approval before production execution.

## Verification performed

Read-only catalog queries inspected the deployed signature, return type, security settings, grants, relevant table columns, and unique indexes. The repository migration was fetched and compared for signature and critical safety checks. No financial row data was queried. No SQL was executed against the production schema beyond SELECT catalog queries; no production changes, live coin tests, merges, or deployments were performed.
