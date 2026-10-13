# Step 36D — Broadcast status response correction

Audit finding: after the Step 36C change, the TRON and EVM dispatch branches stored status BROADCASTED and deferred settlement, but their returned result objects still reported COMPLETED. This was misleading to callers and monitoring.

Fix: both dispatch result objects now report BROADCASTED. This reflects a submitted transaction that has not yet met confirmation-based settlement criteria.

Commit: ff26ae857da625bc2360987cea858237bcb7cc68
Branch: fix/retire-unverified-deposit-entrypoints
File: src/jobs/withdrawalWorker.ts

Validation: inspected the committed source after the change. Build, typecheck, and automated tests were not run. No production database or financial rows were changed. Withdrawal readiness remains unverified; next work must address stale PROCESSING reconciliation and the caller-controlled refund verification flag.
