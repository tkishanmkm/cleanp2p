# EVM Withdrawal Receipt Status Gate — Step 36I

## Audit finding
The EVM confirmation worker previously used `status !== 0` as the success condition. An undefined receipt status could therefore pass the success gate after enough confirmations.

## Fix
- Settlement now requires `status === 1` and the configured confirmation depth.
- Explicit `status === 0` remains quarantined without automatic refund.
- Unknown status does not settle or refund.

## Scope
- Code change is on `fix/retire-unverified-deposit-entrypoints`.
- No production SQL or financial rows changed.
- Build/typecheck/tests were not run. Production readiness is not confirmed.
