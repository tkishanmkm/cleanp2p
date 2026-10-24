# Deposit RPC remediation gates — Phase 01 Step 9

**Status:** Candidate-migration preflight only. No executable replacement SQL is included because one financial policy choice remains unresolved. No production mutation was performed.

## Audited deployed function

The production function is `public.process_deposit_atomic(p_destination_address text, p_asset_symbol text, p_network_code text, p_amount numeric, p_tx_hash text, p_output_index integer DEFAULT 0, p_block_number bigint DEFAULT NULL, p_from_address text DEFAULT NULL, p_token_contract text DEFAULT NULL, p_confirmations integer DEFAULT 0, p_provider text DEFAULT 'internal') RETURNS jsonb`.

It is `SECURITY DEFINER`, with search path `public, pg_temp`. The catalog grant query showed EXECUTE for `postgres`, `service_role`, and `supabase_auth_admin`; it did not show direct grants to `anon` or `authenticated`.

## Step 9 audit findings

1. **Confirmation policy conflict — release blocker.** Production uses 6 confirmations for LTC, while repository migration `20261001000000_canonical_process_deposit_atomic_part6k7.sql` uses 12. The deployed function also uses caller-supplied `p_confirmations`; webhook payload counts are not an independent source of chain finality.
2. **Replay immutability checks differ.** The repository migration contains explicit null-safe checks for existing deposit/on-chain user and amount values and a split-record consistency guard. These exact checks were not found in the deployed function definition.
3. **Network and account gates exist but need parity review.** Deployed function includes user-deposit-address resolution, wallet status checks, advisory transaction locking, and row locking. A replacement must preserve and test the actual account/address eligibility behavior rather than copying the repository migration blindly.
4. **Atomic accounting must be tested, not inferred.** The function updates wallet balances and writes ledger/deposit state. Candidate SQL must demonstrate rollback on ledger insert failure, duplicate callbacks, conflicting user/amount/address/asset/network, and concurrent callbacks.
5. **Canonical confirmation verification remains outside this function.** A function can validate a supplied confirmation integer and threshold, but that alone does not prove the transaction is canonical or that the provider's count is trustworthy. A trusted chain-verification step is needed before crediting.
6. **Schema compatibility is partly verified.** Relevant production columns and canonical unique indexes exist for deposits, on-chain deposits, and deposit ledger references. That is not sufficient to prove full function equivalence; every column, status transition, and constraint must be validated in isolated staging.

## Why executable candidate SQL is intentionally blocked

The candidate migration would affect the timing of irreversible financial credits. Choosing 6 versus 12 LTC confirmations changes that risk policy. It would be unsafe to silently select either value or apply the repository migration as-is. The next implementation commit should be made only after the policy is explicit and the function body has been reconciled line by line.

## Required next actions

- Confirm the required Litecoin deposit credit threshold: 6 or 12 confirmations.
- Decide the authoritative confirmation source per chain (trusted node/provider API or independently verified chain service); never treat a callback's integer alone as proof.
- Build a signature-preserving candidate SQL migration with immutable replay checks and split-state checks.
- Run synthetic-only staging tests: new pending deposit, confirmed credit, duplicate replay, changed user/amount/address/asset/network, duplicate output, concurrency, and forced ledger-write failure.
- Verify transaction rollback, balance delta, exactly-one ledger entry, function grants, owner, and search path.
- Obtain explicit approval before any production SQL execution.

## Verification performed

Read-only queries inspected the deployed function definition, signature, security settings and grants; table catalog queries inspected relevant columns and indexes; the repository migration was fetched for comparison. No financial rows were queried. No live coin tests, production SQL mutation, merge, or deployment occurred.
