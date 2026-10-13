# Step 35Q — Pending deposit credit trust-boundary fail-closed fix

Status: code change committed to `fix/retire-unverified-deposit-entrypoints`; read-back verification completed. Not deployed. Tests/build not run in this environment. No SQL or live database changes were made.

## Audit finding

`src/jobs/depositIngestion.ts` still called `public.process_deposit_atomic` from the pending-deposit confirmation path after checking an EVM receipt, canonical block hash, destination, token contract/Transfer log, and amount. Those checks are useful, but the database RPC still accepts caller-influenced confirmation values and does not independently verify a trusted attestation. Therefore this path could still reach the known unsafe credit boundary.

## Change made

Removed the direct `process_deposit_atomic` call from the pending confirmation path. The path now throws a clear fail-closed error and leaves the pending deposit uncredited until a dedicated, independently protected verifier/credit interface is validated.

## Operational impact — important

- Pending EVM deposits processed through this confirmation refresh path will not be credited by this code until a secure replacement is implemented.
- Legacy scanner credit paths were already fail-closed; this closes another known path to the unverified RPC.
- This may delay legitimate deposits. Before any production rollout, establish a monitored pending-deposit reconciliation/support process and a validated replacement path. Do not deploy this in isolation if it would silently strand customer deposits.
- This does not prove every deposit entry point is closed; a full call-site and runtime inventory is still required.

## Verification

- GitHub file read back and the new fail-closed block confirmed.
- Commit: `922dbbc13492c8fc9d518e72b25495d19325ca73`
- No SQL, Supabase project, secret, wallet balance, production deployment, or staging deployment changed.
- Unit tests, typecheck, build, integration tests, and live runtime behavior remain unverified.

## Exit criteria still open

1. Execute focused tests, typecheck, build, and integration tests in CI or a trusted local environment.
2. Inventory all remaining callers of `process_deposit_atomic` and legacy deposit-credit RPCs.
3. Implement and prove a dedicated trust boundary that ordinary service-role credentials cannot bypass.
4. Run isolated staging negative tests for forged evidence, replay, duplicate concurrency, atomicity, chain reorgs, and key rotation.
5. Obtain the private production schema-only export and reconcile migration history before staging bootstrap or migration changes.

Deposits remain **NOT production-ready**.
