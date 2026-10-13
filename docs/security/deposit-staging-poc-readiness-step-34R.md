# Step 34R — Deposit staging proof-of-concept readiness

Status: preflight audit completed; no POC deployed, no database migration applied, no Supabase branch/project created, and no secrets or balances changed.

## Environment check

- Supabase project `paxonesflows` is ACTIVE_HEALTHY on PostgreSQL 17.6.
- Supabase reports zero development branches. A separate branch/project may have cost or configuration implications, so none was created automatically.
- Installed extensions include `pgcrypto` and `supabase_vault`. `pgsodium` is available in the extension catalog but is not installed. Availability alone does not establish a supported signature-verification primitive or a safe secret boundary.
- The only live public `process_deposit_atomic` routine found in the read-only permission check is `(text,text,text,numeric,text,integer,bigint,text,text,integer,text)`; it is SECURITY DEFINER, denies EXECUTE to anon/authenticated, and permits service_role. It trusts supplied confirmations.
- Existing candidate helper is Node HMAC-SHA-256, with nine test cases. It explicitly warns it is not a trust boundary. The test suite has not been executed and CI has not been confirmed.

## POC blocker

There is no verified isolated staging database in which to test a new credit boundary. Do not apply a migration to the active project just to experiment. A Supabase development branch should only be created after confirming availability/cost and ensuring provider API keys, chain RPC endpoints, secrets, webhook routes, and test wallets cannot affect production.

## Required POC design gate

A viable candidate must separate evidence issuance from the ordinary application credential and make the credit decision impossible to forge by that credential. The current HMAC-in-Vault idea fails this gate because the service-role access model can read Vault secret views and execute the current RPC.

Before implementing the SQL:
1. Establish an isolated staging branch/project and verify no production secrets/provider endpoints are inherited.
2. Choose a supported database-verifiable signature mechanism or a genuinely isolated least-privilege credit service/credential. Demonstrate the isolation with negative permission tests; do not assume an Edge Function using the same service-role key is isolation.
3. Define one canonical signed payload containing nonce, chain/network, tx hash, output/log index, canonical block identity, normalized destination and ownership, asset/contract, raw integer amount, confirmations/tip, verifier version, issue/expiry timestamps.
4. Make nonce consumption, unique transaction identity, ledger entry, and balance credit atomic.
5. Add adversarial tests for forged evidence, expiry, replay, concurrent duplicates, mismatched owner/address/asset/network/contract/amount, insufficient confirmations, reorg, rollback, and successful credits for each supported chain.
6. Run CI and staging integration tests; record evidence before proposing production rollout.

## Result

Step 34R is a preflight decision, not a completed credit implementation. The correct safe action is to stop before staging mutation until an isolated environment and supported verification boundary are confirmed. Production deposits remain NOT READY.
