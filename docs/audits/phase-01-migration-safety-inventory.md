# Phase 01 Step 13 — Migration safety inventory and focused review

**Status:** Partial audit report; no SQL executed. This is not a certification that every migration body has been reviewed.

## Inventory results
- Repository `main` contains 108 files under `supabase/migrations/`.
- Duplicate migration version prefixes detected:
  - `20260919050000`: `20260919050000_fix_enum_trade_status_all_variants.sql` and `20260919050000_fix_enum_trade_status_buyer_marked_paid.sql`
  - `20261002010000`: `20261002010000_p2p_enum_typecast_hotfix.sql` and `20261002010000_remove_legacy_trade_escrow_trigger.sql`
- The connected staging project currently has zero public tables and zero recorded migrations. It is not ready to validate deposit RPC behavior.

## Focused content review — concrete risks

### 1. Canonical deposit migration historical-data guard
File: `supabase/migrations/20260924000000_canonical_deposit_rpc_v2.sql`

The migration counts rows in `public.onchain_deposits` and `public.deposits` and aborts when either contains historical records. This is a protective guard, but it means the migration cannot be assumed replayable against a populated database. Its remaining DDL and preconditions must be checked against the intended target schema before execution.

### 2. Snapshot migration copies existing records
File: `supabase/migrations/20261001010000_part6k14_controlled_blocker_remediation.sql`

This migration creates `_snapshot_6k14o_*` tables and conditionally copies wallet-address, function-definition, constraint, wallet, and P2P baseline data. Review data sensitivity, table privileges/RLS, retention, repeatability, and the exact expected schema before running it anywhere. Do not run this as a casual staging setup step.

### 3. Legacy deposit listener has a privileged function and metadata-based authorization
File: `supabase/migrations/20260831000002_deposit_listener.sql`

The older `credit_user_deposit` function is declared `SECURITY DEFINER` with `search_path = public`. Its associated read policy includes `raw_user_meta_data->>'role' = 'admin'`. User-editable metadata must not be trusted for authorization. Confirm whether this legacy RPC is still callable, inspect its full body and grants, and revoke/replace it only after tracing all callers and compatibility requirements.

### 4. Broad exception suppression in enum migrations
Files:
- `supabase/migrations/20260919050000_fix_enum_trade_status_all_variants.sql`
- `supabase/migrations/20260919050000_fix_enum_trade_status_buyer_marked_paid.sql`

The inspected sections catch `WHEN OTHERS` around enum changes. Suppressing all errors can hide a genuine schema/permission failure. Determine whether each catch is still necessary and ensure failures are surfaced or explicitly logged in the reviewed migration plan.

### 5. Duplicate migration version prefixes
Two pairs share the same timestamp/version prefix. Depending on the migration runner's version parsing and history, duplicate versions can cause ambiguity, ordering conflicts, or replay problems. Do not rename or rewrite already-applied production migration history in place. Resolve via a reviewed, forward-only migration-history strategy and verify behavior with the actual CLI/version.

## Scope limitation
This step completed a repository-wide migration filename inventory and a focused content review of selected deposit/security/high-risk migrations. It did **not** successfully retrieve and statically analyze the body of all 108 files in one automated pass; that batch exceeded the connector's tool-call limit. Therefore, the report deliberately does not claim a full body-by-body audit.

## Safe next actions
1. Perform the remaining content audit in bounded batches, prioritizing DDL/destructive statements, SECURITY DEFINER functions, grants, RLS, dynamic SQL, data-copy/snapshot code, and network/testnet restrictions.
2. Resolve duplicate-version handling in a proposal without changing production history.
3. Build a reviewed dependency/order manifest and identify migration assumptions requiring existing production objects or data.
4. Use a disposable database or isolated staging environment to replay only the approved baseline.
5. Test deposit RPC behavior using synthetic fixtures and the selected 12-confirmation Litecoin policy.
6. Do not apply DDL to production, merge, or deploy without explicit approval.

## Non-actions
- No production or staging SQL executed.
- No production financial rows queried or modified.
- No live coins, production secrets, merge, or deployment.
- No claim that deposit handling or wallet flows are production-ready.
