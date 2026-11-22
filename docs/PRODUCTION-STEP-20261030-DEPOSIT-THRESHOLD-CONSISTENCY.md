# Paxones Production Step — Deposit Threshold Consistency
Date: 2026-10-30

## Finding
Read-only comparison of src/jobs/confirmationsWorker.ts, supabase/migrations/20261024120000_deposit_pending_registration_hardening.sql, and supabase/migrations/20260924000000_canonical_deposit_rpc_v2.sql found inconsistent BTC/LTC thresholds.

| Network | Pending registration / worker | Canonical credit RPC |
|---|---:|---:|
| BTC | 3 | 1 |
| LTC | 12 | 6 |
| ETH | 12 | 12 |
| ERC20 USDT | 12 | 12 |
| BEP20 USDT | 15 | 15 |
| TRC20 USDT | 19 | 19 |

## Impact
The worker currently verifies chain confirmations and refuses to call the credit RPC below its configured threshold. That is a meaningful control. However, the database RPC independently defines lower thresholds for BTC and LTC, so the database-level rule is weaker than the worker policy. This is a policy inconsistency, not proof of a premature credit.

## Recommended resolution
Before changing SQL, confirm the intended product risk policy and treat the worker's BTC=3 / LTC=12 settings as the current expected values only if product/security owners approve. Then align the canonical RPC and pending-registration migration, add tests asserting the same matrix in all three locations, and test on a disposable schema. Inspect deployed function definitions and grants before rollout. Do not execute the historical canonical migration blindly: it contains an explicit abort if historical deposit rows exist.

## Verification limits
Source-only comparison. No live database/schema inspection, no migration execution, no code change, no commit/push/deploy, and no financial transaction.

## Status
Deposit crediting remains partially audited and is not production-certified.