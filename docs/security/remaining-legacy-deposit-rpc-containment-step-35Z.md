# Step 35Z — Remaining Legacy Deposit RPC Containment

Date: 2026-10-14  
Repository: `tkishanmkm/cleanp2p`  
Branch: `fix/retire-unverified-deposit-entrypoints`  
Production Supabase project: `eaiwgfxoiwxepinvcykg`

## Audit finding

The production function `public.process_confirmed_deposit(uuid)` was executable by `service_role`. Its implementation credits the amount and asset from an `onchain_deposits` row, marks that row `CONFIRMED`, and writes a ledger entry, but it does not independently validate chain receipt evidence, confirmation depth, or canonical transaction identity before crediting. A repository search did not find a current application caller. This was treated as a legacy credit entry point.

The earlier suspected missing `process_user_deposit` overload was rechecked against the live database: four overloads exist, and all four already deny EXECUTE to `anon`, `authenticated`, and `service_role`. No additional overload was found in the live inventory.

## Change applied

Added migration `supabase/migrations/20261014010000_revoke_unverified_process_confirmed_deposit.sql` and applied the narrow permission change to production:

```sql
REVOKE EXECUTE ON FUNCTION public.process_confirmed_deposit(uuid) FROM service_role;
```

## Live verification

After applying the migration, queried live PostgreSQL function privileges. Verified that all inspected legacy deposit-credit RPCs now deny EXECUTE to `anon`, `authenticated`, and `service_role`, including `process_confirmed_deposit(uuid)` and the four `process_user_deposit` overloads.

## Impact and limitations

- No wallet balances, deposit rows, or ledger rows were changed by this migration.
- Automatic deposit credit remains disabled/fail-closed pending a separately audited replacement.
- Deposits may remain pending until a verified credit path is implemented.
- No build, automated tests, or end-to-end deposit tests were run as part of this permission containment step.
- This is not a declaration that the wallet system is production-ready; the verified deposit-credit flow remains incomplete.

## Next recommended step

Continue the withdrawal settlement work: design and test a distinct idempotent reverted-transaction settlement path that binds evidence to the exact stored transaction hash and network, without trusting a free boolean supplied to the refund RPC. Do not broadly revoke worker permissions or enable refunds without a verified replacement.
