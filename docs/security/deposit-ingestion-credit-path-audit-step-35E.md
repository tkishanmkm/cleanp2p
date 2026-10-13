# Step 35E — Remaining deposit ingestion credit-path audit

Date: 2026-10-14
Branch: `fix/retire-unverified-deposit-entrypoints`

## Scope
Audited `src/jobs/depositIngestion.ts`, its pending-deposit recheck function, and the authenticated routes `src/app/api/cron/indexer/route.ts` and `src/app/api/workers/deposit-worker/route.ts`. The confirmations route was also read to confirm it uses the fail-closed worker from Step 35D.

## Findings

### 1. Legacy scanner credit calls are currently fail-closed
The scanner paths for EVM token/native transfers, TRON, BTC, and LTC route through `rejectUnverifiedScannerCredit()`, which returns an error and does not call the database credit RPC. The scan implementations still detect events and contain legacy parsing weaknesses (including floating-point conversions and provider-supplied confirmation assumptions), but these values do not currently reach the credit RPC through that helper.

### 2. Pending recheck is the remaining application call site that can credit
`refreshPendingDepositConfirmations()` selects up to 50 `PENDING` rows and supports EVM networks only. It checks transaction/receipt availability, successful receipt status, canonical block hash, destination, token contract and Transfer log identity, positive on-chain amount, exact normalized decimal amount, and derives confirmations from the current chain tip. Unsupported chains fail closed with an error.

The path does **not** provide a complete multi-chain replacement: pending TRON/BTC/LTC rows are not verified or credited by this function. It also relies on the database RPC's caller-supplied `p_confirmations` and privileged caller identity.

### 3. The database trust boundary is still unresolved
Production `public.process_deposit_atomic(...)` trusts caller-influenced confirmation count to decide whether to credit, and `service_role` can execute it. Therefore the database itself does not prove canonical chain evidence or a signed, independently verified attestation. Even a well-behaved application verifier does not make the RPC safe against another privileged code path or a leaked service-role key.

Do not revoke service-role execution blindly: that may break the only current pending EVM credit path. A safe fix requires an isolated verifier/attestation trust boundary and a tested replacement migration.

### 4. Worker response text was misleading
The deposit worker route described ingestion as completed “via canonical process_deposit_atomic”, which implied more coverage than exists. Updated the message to accurately state that direct scanner credit is disabled and only verified supported EVM pending deposits may be attempted.

## Decision
The current pending EVM verifier is a **candidate component**, not yet an approved single production credit path. No production SQL or deployment changes were made. No tests/build were run as part of this step.

## Required before production
1. Establish a verifier identity or signed attestation that the ordinary `service_role` cannot forge, and enforce it at the database credit boundary.
2. Add a canonical evidence strategy for TRON, BTC and LTC, or explicitly disable those deposit networks until implemented.
3. Build schema-faithful staging from reviewed migrations/baseline; the existing staging project is empty and cannot validate this path yet.
4. Test forged confirmations, wrong recipient, wrong asset/contract, amount mismatch, duplicate/replayed deposit, reorg, insufficient confirmations, provider outage, and concurrent duplicate processing.
5. Run unit/integration tests and a production build; verify deposit UX and worker telemetry before rollout.

## Status
- Unsafe legacy endpoint retirements: proposal branch only
- Confirmation worker credit path: disabled on proposal branch
- Direct scanner credit: disabled on proposal branch
- Pending EVM recheck: canonical checks present, DB trust boundary unresolved
- TRON/BTC/LTC pending credit: not supported by this verifier
- Staging integration tests/build: not run
- Production readiness: **not ready**
