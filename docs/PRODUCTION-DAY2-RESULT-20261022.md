# Production Readiness — Day 2 Result (2026-10-22)

## Scope
Investigated the `/my-ads` edit/status/delete user-reported failures and stale/deleted advertisement reappearance. Changes are local only; no commit, push, deployment, or live database mutation was performed.

## Confirmed issue fixed
`src/app/(dashboard)/my-ads/page.tsx` previously treated `rawAds.length === 0` as a reason to run a direct database fallback even after `/api/p2p/my-ads` had successfully returned an empty ads list. This could make stale rows appear again from an older data path. The page now records a successful API response with `success === true` and an ads array as authoritative, including an empty array, and skips the fallback in that case.

Added `tests/my-ads-authoritative-empty-response.test.ts` to guard this behavior.

## Additional issue fixed
`src/components/ManageAds.tsx` optimistically changed an ad's status or removed it from the component before the server confirmed persistence. Its fallback API calls also did not check `response.ok`, so an HTTP error could be treated as success. The component now checks HTTP responses and only updates its own local state after a successful response. When parent callbacks are supplied (as on `/my-ads`), the parent remains responsible for updating the authoritative list after the API result.

Added `tests/manage-ads-failed-mutation-state.test.ts` to guard the failure-state behavior.

## Additional edit validation hardening
The `PUT /api/ads/[adId]` handler previously used numeric comparisons that do not reject `NaN` (for example, malformed client input such as a non-numeric price or margin). It now rejects non-finite or non-positive price/unit price/min/max values and non-finite/out-of-range dynamic margins with HTTP 400 before attempting database writes. Added `tests/ad-edit-numeric-validation.test.ts`.

## Verification
- Seven targeted regression tests: **7 passed, 0 failed** (authoritative empty response, stale-row resurrection, legacy delete state, canonical schema payload, strict boolean status, failed mutation UI state, and edit numeric validation).
- `git diff --check`: **passed** (line-ending warnings only, checked after code/test changes).
- Fresh `npm run typecheck`: **passed**, exit code 0 after the latest numeric-validation change.
- Playwright end-to-end suite: **3 passed, 0 failed** — login page WCAG 2 A/AA accessibility scan, public home-page smoke test, and login-page smoke test. This ran locally with placeholder Supabase environment values and did not test authenticated ad mutations or production connectivity.
- Playwright emitted Watchpack EINVAL warnings while scanning Windows system files and a Next.js development cross-origin warning. The 3 tests passed, but the watcher-root warning should be investigated before relying on local development-server stability.

## Remaining Day 2 validation
- Run authenticated end-to-end checks for edit, pause, resume, and delete using a disposable test ad and test user.
- Verify HTTP response bodies and persisted canonical row state; confirm deleted ads do not reappear in `/my-ads`, `/buy`, or `/sell`.
- Do not test mutations against real customer ads or production financial data.

## Follow-up verification (2026-10-22)
- Expanded safe local regression run: **30 tests passed, 0 failed** across migration contracts, ad payload validation, withdrawal input validation, trade guards, privacy checks, and 2FA session compatibility.
- Read-only production schema inspection confirmed that the live `p2p_ads` table contains the edit payload's `asset_symbol`, `crypto_currency`, `coin`, `fiat_symbol`, `fiat_currency`, `price`, `min_limit`, `max_limit`, `margin`, `pricing_type`, `payment_methods`, `payment_method`, `terms`, `type`, `ad_type`, and `min_completed_trades_req` columns. This disproves the specific hypothesis that those aliases alone explain edit failures; no change was made based on that hypothesis.
- Did **not** run the repository's `test:all` financial integration suite: those scripts upsert wallets/ads, call escrow/deposit/withdrawal RPCs, and alter test balances. The helper requires explicitly configured disposable database credentials and an opt-in mutation flag; the production project must not be used for these tests.
- No authenticated mutation test account/ad is configured yet. Therefore edit/pause/resume/delete persistence remains unverified end-to-end.

## Overall status
Day 2 is **partially complete**: the confirmed empty-list resurrection path is fixed and covered by passing regression tests. The broader local suite adds confidence, but does not establish live mutation correctness. Authenticated ad edit/status/delete validation remains outstanding. Day 1 production migration reconciliation remains a separate production gate. No commit, push, deployment, GitHub Actions run, or Supabase data/schema change was performed.
