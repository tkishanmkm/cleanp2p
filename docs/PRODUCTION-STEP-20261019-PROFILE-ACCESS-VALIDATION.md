# Production Step — Profile Access Privilege Validation (2026-10-19)

## Scope and safety

Read-only inspection of the connected Supabase project `paxonesflows` plus local source inventory. No SQL writes, migrations, user changes, financial operations, commit, push, or deployment were performed.

## Confirmed live database finding

A read-only catalog query returned:

- `has_table_privilege('anon', 'public.profiles', 'SELECT') = false`
- `has_table_privilege('authenticated', 'public.profiles', 'SELECT') = false`
- No public-schema view with a name containing `profile` was found.
- The table has a SELECT policy named `Public profiles are viewable by everyone`, but RLS policy presence does not grant SQL SELECT privilege. Therefore that policy alone cannot make client reads work.

The app has a broad direct-profile-query footprint: a local ripgrep inventory found references in 144 source files/paths matching `from(...profiles...)` (includes server-side/service-role calls, so this is not a count of browser-only calls). Examples of browser/client usage include `src/lib/hooks/useUserProfile.ts`, `src/app/users/[username]/UserProfileClient.tsx`, `src/app/users/[username]/page.tsx`, `src/components/trade/counterparty-info-panel.tsx`, `src/components/providers/UserPresenceProvider.tsx`, `src/hooks/usePresenceHeartbeat.ts`, and the ad-creation page. Several server/API flows also query profiles and must be classified separately.

The local public profile API at `src/app/api/users/[username]/route.ts` uses a service-role client to query `profiles` with an explicit column allowlist, then falls back to `public_profiles`. The live catalog inspection found no view matching `public_profiles`, so the fallback is not currently backed by a confirmed live view. Do not solve this by granting broad SELECT on `profiles`: the table contains sensitive account, KYC, wallet/address, and security-related fields.

## Validation performed in this step

- All discovered `*migration.test.ts` contract tests completed successfully.
- `npm run typecheck`: PASS.
- `git diff --check`: PASS; Git emitted only Windows LF/CRLF normalization warnings.
- Live Supabase security advisor returned no security-lint findings in this read; performance advisor still reports policy/index warnings and duplicate indexes. Those findings need individual review and are not auto-remediated here.
- The separate `cleanp2p-staging` project returned no public tables and no migration history; it is not a usable schema-matched test database.
- Live migration history for `paxonesflows` ends at 2026-10-16; local 2026-10-17 through 2026-10-19 migrations remain unapplied.

## Next implementation gate

1. Build a file-by-file inventory that separates browser clients, server-cookie clients, service-role clients, and public-page reads, and records the exact columns each requires.
2. Route public trader-card/profile reads through a narrow, explicit public-profile API/view with no sensitive columns; make the API fail closed if the source schema is unavailable.
3. Move self-profile reads and mutations to authenticated server routes/RPCs that derive identity from the verified session. Do not allow clients to set admin, KYC, presence, wallet, or account-status fields.
4. Replace browser direct reads/updates incrementally and add regression tests for public profile, onboarding, ad creation, presence, trade counterparty cards, settings, and admin pages.
5. Only then prepare a minimal privilege/view migration and test it against a disposable, schema-matched database before any live application.

## Release status

**NOT PRODUCTION READY.** This is a compatibility and security blocker. No live changes were made.
