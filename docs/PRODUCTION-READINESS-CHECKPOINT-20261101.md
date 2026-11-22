# Paxones production-readiness checkpoint — 2026-11-01

## Overall release status

**NOT PRODUCTION READY — DO NOT LAUNCH YET.**

This checkpoint is based on read-only inspection of the connected production Supabase project, the staging project, and the local `C:\Users\theki\cleanp2p` working copy.

No production database migration was applied. No Edge Function was deployed. No wallet/ledger/withdrawal row was changed. No commit or push was made. No build, typecheck, unit test, integration test, smoke test, or end-to-end test was run in this pass, in accordance with the instruction to defer all testing.

## Confirmed production database state

Production project: `paxonesflows` (`eaiwgfxoiwxepinvcykg`).

- PostgreSQL 17.6.1.166; project reported ACTIVE/HEALTHY during inspection.
- 80 public application tables; all 80 currently have RLS enabled.
- 5 public views; all 5 currently set `security_invoker=true`.
- 119 public RLS policies.
- Production migration ledger: 81 migrations, latest `20261016013425`.
- Local migration directory: 182 SQL files after the current local candidate was added; latest `20261101120000_fix_database_advisor_findings.sql`.

Staging project: `cleanp2p-staging` (`tazvjyrdondcrdrkggqe`).

- Project reported ACTIVE/HEALTHY during inspection.
- No application tables were found in the public schema.
- Staging is therefore not a populated schema-faithful validation target.

**Release gate:** migration provenance and the 101-version local/remote gap must be reconciled before applying this local migration chain. Do not apply the directory blindly to production or staging.

## High-severity functional blocker — withdrawals

The live application request/worker/settlement contracts do not match the production database:

- Production has no `withdrawal_idempotency_keys` table.
- Production has no request idempotency RPC matching the local request path, and no replay lookup RPC matching the local service.
- Production has no owner-token/fenced `claim_pending_withdrawals(text, integer)` overload.
- Production has no `record_withdrawal_broadcast` or `record_ambiguous_withdrawal_broadcast` RPC.
- The live `claim_pending_withdrawals(integer)` function is the legacy unfenced overload.
- Production `withdrawals` has no `wallet_id`, `idempotency_key`, or `metadata`, and has required columns `chain`, `token_symbol`, and `to_address`.
- Production `ledger_entries` uses the legacy `crypto`, `amount`, `type`, `reference_id`, `balance_after`, `metadata`, `asset`, `chain`, and `status` contract. It does not have the double-entry columns expected by the current local withdrawal settlement implementation.
- Production `wallets` has required `chain`, `address`, and `derivation_index`; the local legacy request function references nonexistent wallet state columns.
- Production-only `request_custodial_withdrawal` is not a safe drop-in substitute: it writes an on-chain row but does not create the companion `withdrawals` row expected by the local worker/settlement flow.

The current local withdrawal readiness note remains applicable:
`docs/PRODUCTION-STEP-20261031-WITHDRAWAL-RPC-TABLE-CONTRACT-BLOCKERS.md`.

**Do not enable production withdrawals or try to repair this with isolated columns.** A canonical atomic design must create paired request records, reserve spendable `wallet_assets`, write the actual live ledger schema, preserve idempotent retries, and add fenced claim/broadcast/reconciliation behavior in one consistent migration series.

## Supabase advisor findings

### Security

- 3 INFO findings: `user_2fa_pending_enrollments`, `user_2fa_recovery_codes`, and `user_security_audit_logs` have RLS enabled with no user policies. Catalog grants confirmed no `anon`, `authenticated`, or `PUBLIC` table privileges on these tables; their current service-only access is intentional. Do not add broad user policies to silence the advisory.
- 18 WARN findings: authenticated callers can execute SECURITY DEFINER functions. These were not bulk-revoked: each inspected function denies `anon`, has a fixed search path, and is designed as an authenticated application RPC or a separately gated operation. Revoke/convert only after auditing exact call sites and in-body identity/role checks.
- The live `mark_p2p_trade_paid` and `raise_trade_dispute` function bodies included a `raw_user_meta_data ->> 'role' = 'admin'` check. This value is user-editable and must not establish administrator privilege.
- The live `Admins can view platform ledger` RLS policy also trusted `raw_user_meta_data`. Its unsafe branch is removed in the local advisor migration candidate; that migration has not been applied.

The separate helper `get_emergency_mode()` returns only the current emergency-mode boolean and raises if the setting is missing/invalid. This is not equivalent to a privileged write RPC and was not blindly revoked.

### Performance

- 5 missing foreign-key indexes were identified:
  `deposits(user_id)`,
  `platform_ledger_entries(related_user_id)`,
  `profiles(emergency_frozen_by)`,
  `sweep_queue(user_id)`,
  `utxo_reservations(sweep_id)`.
- 38 RLS policies were flagged for direct per-row auth function evaluation. A local migration candidate rewrites only the exact advisor-listed policies, preserving roles, commands, and existing USING/WITH CHECK predicates while converting direct `auth.<function>()` calls to scalar SELECT calls.
- A local migration candidate also removes the platform-ledger policy's user-editable admin metadata branch while retaining `public.is_admin()` and the trusted `raw_app_meta_data` path.

## Important local SQL correction

The existing un-applied migration
`20261019130000_remove_user_metadata_admin_trust_from_trade_rpcs.sql`
originally used a regular expression that could consume the parentheses surrounding an unsafe predicate. A read-only preview against the live function definitions showed malformed fragments such as `ORFALSE` and changed boolean grouping in the generated function source.

That migration was corrected locally so the regular expression replaces only the predicate expression `raw_user_meta_data->>'role' = 'admin'` with `FALSE`, preserving its surrounding parentheses and boolean operators. The corrected migration still requires isolated SQL validation before application. It has not been executed.

## Local code hardening performed in this pass

All of the following are local, uncommitted working-tree edits only:

1. `.gitignore`: corrected environment-file ignore patterns to ignore `.env` and `.env.*`, keeping only `.env.example` explicitly unignored.
2. `src/lib/supabase/server.ts`: added the `server-only` boundary; removed the hard-coded production project fallback and placeholder anon key; invalid/missing Supabase URL or anon key now fails closed.
3. `src/lib/supabaseAdmin.ts`: added the `server-only` boundary and removed the placeholder URL fallback for privileged client creation.
4. `src/context/i18n-context.tsx`: synchronizes document `lang` and RTL/LTR direction to selected language and protects language selection from localStorage failures.
5. `supabase/functions/send-email/index.ts`: added bounded request-body parsing, stricter payload type/length checks, fixed-size digest comparison for the function secret, no-store headers, server-to-server-only CORS behavior, SMTP connection timeouts, mandatory STARTTLS on non-465 ports, and reduced PII in logs.
6. `supabase/migrations/20261101120000_fix_database_advisor_findings.sql`: added five missing indexes, 38 guarded policy performance rewrites, and the platform-ledger user-metadata policy correction.
7. `supabase/migrations/20261019130000_remove_user_metadata_admin_trust_from_trade_rpcs.sql`: fixed the unsafe regex replacement as described above.
8. `src/app/api/trades/[tradeId]/system-message/route.ts`: added a streaming 64 KiB request-body limit, per-field metadata type/length validation, bounded display names, and removed email-derived public display-name fallbacks.
9. `src/lib/trade-system-message-locales.ts` and `src/components/trade/trade-chat.tsx`: added localized automatic system-event messages/titles/badges for all 11 active languages, carrying stored event type/metadata through history and immediate local dispatch. Arabic system-event text uses RTL alignment. User-authored trade messages and free-text dispute reasons/comments are not translated or changed.
10. `src/components/legal/legal-document-banner.tsx`, `src/app/terms/page.tsx`, and `src/app/policy/page.tsx`: legal document headings, official-document labels, effective/updated date labels, translation disclosure and the Terms risk-warning heading now follow the selected locale.
11. `src/components/layout/footer.tsx`: the legal footer heading and Terms/Privacy link labels now use the selected locale. No standalone AML policy route or reviewed AML policy body exists in the repository, so no unverified AML compliance statements or invented legal content were published.
12. `src/app/(dashboard)/dashboard/page.tsx` and `src/app/(dashboard)/wallets/page.tsx`: the dashboard overview, balance/active-trade labels, platform resource links, unified wallet labels, deposit/withdrawal history labels, common status labels, and detail modal headings now use translations. Dashboard/wallet currency and history date/time formatting uses the selected locale. No financial calculations, wallet API calls, transaction writes, or ledger behavior were changed.
13. `src/components/wallets/deposit-dialog.tsx`, `withdraw-dialog.tsx`, and `transfer-dialog.tsx`: localized dialog headings, network/recipient/amount labels, fee summaries, address states, KYC and 2FA prompts, known form validation, and static success/failure notices across all 11 active locales. The withdrawal/transfer calculations, fee percentages, API payloads, recipient restriction logic, idempotency keys, and transaction/ledger flows were not changed. Server-returned free-form error messages remain as supplied by the API; only known local validation and fallback messages are localized.
14. `src/components/wallets/transfer-history-table.tsx`: localized the shared desktop table, mobile cards, empty state, party labels, status badges, transfer detail dialog, fees, transfer IDs, copy tooltip, and date/time display. It is reused by the unified-wallet page and the dedicated transfer page. Fallback `You`/ `Trader` names are localized without treating a real counterparty username as a system label.
15. `src/app/(dashboard)/transfer/page.tsx`: localized the direct user-to-user transfer form, recipient restriction/KYC/2FA notices, fee description and max-amount helper, validation errors, submit state, success/failure notifications, and history tabs. Dynamic amounts, fee values, recipient names and transfer IDs are inserted into locale templates. API-returned error details are preserved as received rather than being translated speculatively.
16. `src/app/(dashboard)/wallets/page.tsx`: split deposit and withdrawal status-to-label mapping so a pending withdrawal is not mislabeled as blockchain-confirming. Added mappings for confirmation, detection, pending/processing, broadcast, completed, failed, cancelled, refunded and approval states. No underlying status transitions or financial operations were changed.
17. `src/app/(dashboard)/notifications/page.tsx`: localized the inbox heading, mark-all-read action, card labels and empty states. Relative timestamps now use the active date-fns locale for all 11 languages. The original notification message body is displayed without rewriting because its content is supplied by the notification service.
18. `src/app/(dashboard)/my-tickets/page.tsx`: localized the support-ticket heading, history description, submitted-at label, message/admin-reply labels, empty state and Open/In Progress/Closed badges. Relative timestamps use the active date-fns locale. Ticket messages and administrator resolution notes remain exactly as stored; status label normalization affects presentation only. Removed an unused profile/display-name lookup from the ticket-fetch callback.
19. `src/app/(dashboard)/my-ads/page.tsx`: localized the My Ads heading, description, market badge, create button, loading state, and activation/deactivation/deletion notifications. API-provided error messages are retained; known local fallback messages are translated.
20. `src/components/ManageAds.tsx`: localized shared desktop/mobile ad management labels, active/inactive status badges, edit/share/info/pause/start actions, detail and share dialogs, payment/terms labels, and confirmation prompt. Price and limit formatting now uses the selected locale. WhatsApp, Telegram and X pre-filled messages use translated templates with matching dynamic placeholders. Public ad URLs, share destinations, status toggle/delete callbacks, price calculations and available-balance calculations are unchanged.
21. `src/app/(dashboard)/ads/create/page.tsx`: localized the create-ad form across all 11 active locales, including buy/sell and asset/fiat labels, payment categories/search/custom method controls, pricing/rate explanation, minimum and maximum limits, live-balance guidance, payment windows, targeted/blocked-country controls, terms, offer label, tags and trader requirements. Known local validation and publication feedback now uses localized templates. Canonical payment method names, currency and country identifiers, tag values, limits and selected data remain unchanged.
22. `src/app/(dashboard)/ads/edit/[adId]/page.tsx`: localized the edit-ad form, loading/error view, payment categories/search, pricing and limit controls, payment window, country targeting, tags, trader requirements, cancel/save actions and known validation/update messages. Dynamic values use locale-aware number formatting. HTTP-status errors keep the status code while presenting a translated message; API-returned error details remain visible. The existing edit/load, pricing-change detection, and PUT payload semantics remain unchanged.
23. `src/app/(dashboard)/buy/page.tsx` and `src/app/(dashboard)/sell/page.tsx`: localized marketplace controls, asset/payment/currency selectors, sort/filter dialogs, tag and country filters, KYC-limit notices, live-price fallback, guided tours, numbered buyer and seller how-to guides, and their distinct FAQs. `src/components/p2p/ad-card.tsx` localizes action buttons, price/limit headings, trade counts, offer tag labels, detail headings, payment-window text, online/offline/last-seen labels and joined-date text; numeric price/limit formatting follows the selected locale. `src/components/p2p/active-trades-list.tsx` localizes trade roles, known status labels, title and view action, and locale-formats fiat amounts. Original payment/country/currency identifiers, offer terms/labels, status values, ad filter values, prices, escrow/trade logic and route/API behavior remain unchanged.
24. `src/app/(dashboard)/trades/page.tsx`: localized trade-history heading, CSV action button, total-volume/completed-trades/feedback labels, table headings, buyer/seller role badges, known trade statuses, loading/empty states, view action and unavailable-date fallback. Total volume now uses the selected locale. The Supabase query, trade-status derivation, CSV export data and transaction semantics were not changed.
25. `src/app/trade/[id]/page.tsx`, `src/components/trade/trade-details.tsx`, `trade-chat.tsx`, `counterparty-info-panel.tsx`, and `src/components/trade-chat-timer.tsx`: localized the trade-room load/permission states and mobile navigation; trade-detail financial/status headings, buyer/seller action prompts, payment/escrow/dispute/report dialogs, category/reason display labels, feedback form, dispute-resolution summary, seller-terms heading, and admin action controls; counterparty profile/reputation/block labels and feedback; chat composer, buyer/seller payment instructions, status/presence labels, structured security notices, evidence privacy selection, 32 MB upload guidance, attachment previews, and post-trade completion card; and payment-window/elapsed-time timer labels. Amounts and timer values use the active locale. The canonical dispute/report reason values, `all`/`moderator_only` visibility values, chat messages, seller-authored terms, user feedback, moderator notes, payment-method values, file limits, API payloads, fee/escrow calculations, status transitions, authorization checks, and transaction persistence were not changed. System/API free-form content remains as supplied.
26. `src/app/ad/[adId]/AdDetailClient.tsx`, `src/components/p2p/trade-initiation-modal.tsx`, and `src/components/user-status.tsx`: localized public advertisement detail headings, trade-amount form labels, known validation messages, escrow fee breakdown headings, payment-window labels, offer/payment-method headings, trader reputation metrics, presence/joined-date labels, and the reusable buy/sell initiation modal (pricing/limits, payment selection, amount inputs, validation and escrow summary). Locale-aware number/date/presence formatting now applies to these surfaces. Advertiser-written terms, ad labels, usernames, supported payment-method values, and server-returned error text remain unchanged. The public ad action’s idempotency key and escrow action call, the reusable modal’s `/api/trades/initiate` request/idempotency header and payload, amount/fee calculations, minimum/maximum-limit rules, KYC/availability checks and redirects were not changed.
27. `src/app/users/[username]/UserProfileClient.tsx`, `src/app/user/[username]/page.tsx`, and `src/app/ads/page.tsx`: localized public trader-profile verification badges, presence and joined-date labels, trader statistics, Buy/Sell offer tabs/cards, order-limit and unit-price headings, empty offer states, feedback headings/filters/results, the compact public user status page, and the public active-P2P-offers listing. Profile/listing prices, numbers and dates use the selected locale. Usernames, merchant-tier data values, asset symbols, payment-method names, advertiser terms, and user-written feedback remain unchanged. The public profile query/visibility rules, narrow `/api/users` reader, ad listing queries/fallback, active filtering/order, links and all API/data behavior were preserved.

The email and system-event request readers enforce byte limits while streaming instead of loading an unbounded body before checking its size. Automatic events with structured event type/metadata now render in the selected language; legacy system messages without structured metadata retain their original text. The Terms and Privacy legal clauses themselves remain English and display a localized disclosure explaining that they have not yet received a professionally reviewed full translation. The dashboard, unified-wallet route, deposit/withdraw/transfer dialogs, shared transfer-history component, dedicated direct-transfer page, notifications inbox, support-ticket history, My Ads management, Create/Edit Ad forms, Buy/Sell marketplace listings, public advertisement detail client, reusable trade-initiation modal, public trader-profile clients, compact public user status page, public active-ad listing, trade-history table and trade-room detail/chat route are partially localized. All 11 active locale JSON files were parsed and checked for matching key paths. Dynamic placeholders for transfer, notification, ticket, ad-sharing, ad-form, marketplace guide, ad-card, trade-history, public-profile and public-offer templates were compared across locales. Notification bodies, ticket messages, admin replies, feedback comments and API-returned free-form errors remain as supplied. No application build or automated test suite has been run in this pass, and the Edge Function hardening has not been deployed.

## Secrets, transport, and encryption review

- A limited source-pattern scan found no tracked `.env` file, no obvious JWT/private-key/service-role literal in the scanned application/public source, and only `.env.example` was tracked as an environment file. Its values are placeholders/empty.
- This is a bounded static scan, not proof that there are zero leaked keys in every branch, build artifact, Git history, deploy environment, logs, backups, connected provider, or third-party service.
- Service-role usage was found in server-only route/service code; no service-role references were found in the scanned components, hooks, or context folders. The newly marked server-only modules are not imported directly by the scanned client component directories.
- Supabase Edge secrets could not be enumerated through the connected tooling, so secret presence, rotation, entropy, and deployment configuration remain unverified.
- HTTPS/TLS protects transport in the normal Supabase/Next.js flow. Encrypting all executable backend code so nobody can decode it is not technically achievable: the server must load and execute its code, and an authorized service must decrypt data to operate. Sensitive stored fields require a specific field-level encryption/key-management design; that design and key rotation have not been certified here.

## Localization status

The 11 selectable languages are:
`en`, `zh-CN`, `zh-TW`, `pt-BR`, `ko`, `fr`, `es`, `ru`, `vi`, `ar`, and `hi`.

All 11 active dictionaries currently contain the same 1,387 leaf-key paths. This includes the previously listed dashboard, wallet, transfer, notifications, support-ticket, ads, marketplace, trade-history and trade-room namespaces, plus `counterpartyPanel` (30 keys), `tradeRoomPage` (6), `tradeActionPage` (83), `tradeDetailsPage` (64), `tradeFeedbackPage` (21), `tradeChat` (113 keys), `tradeChatTimer` (3), `adDetailPage` (50), `tradeInitiation` (36), `publicProfile` (55), `publicAdsPage` (11) and `publicUserPage` (3). All 11 active JSON files were parsed successfully and their key paths match exactly. Placeholder parity passed across all keys. Static verification for the public profile/listing components checked 89 literal translation references and 15 dynamic references; public ad detail/trade initiation checked 109 literal and 19 dynamic references; the preceding trade-room check was 345 literal and 19 dynamic. `bho.json` and `en-IN.json` remain inactive.

This does **not** constitute whole-app localization:
- the Terms and Privacy pages localize document titles, official-document badges, effective/updated date labels, the translation disclosure, and the Terms risk-warning heading; their substantive 67 Terms sections and 20 Privacy Notice sections remain English pending professional legal translation and review;
- footer legal navigation is localized across all 11 active locales;
- the authenticated dashboard overview and unified-wallet route localize their main visible labels, history tables/statuses, and transaction detail headings;
- the deposit, withdrawal, and internal-transfer dialogs localize their labels, fee summaries, known form validation, 2FA/KYC notices, and static toast feedback; arbitrary server-returned error text is preserved and can still appear in the server's language;
- the shared transfer-history component now localizes desktop/mobile views, detail dialogs, status badges and locale-aware timestamps; the dedicated direct-transfer page localizes its form, fee descriptions, known validation, notifications and history tabs;
- the notifications inbox and support-ticket history localize controls, headings, empty states, known ticket statuses and relative timestamps; original notification bodies, user-submitted ticket messages and administrator replies are not rewritten;
- the My Ads page and shared management component localize list headings, desktop/mobile statuses and actions, share/details dialogs, payment/terms headings, locale-aware numbers, and the three pre-filled social-share messages; ad state/publishing logic and share destinations remain unchanged;
- the create and edit advertisement forms localize the form controls, payment category labels, rate/limit helpers, country targeting dialogs, trader requirements, submit states and known validation errors; canonical method/asset/currency/country/tag values and API payload fields remain unchanged, and server-provided error details are preserved;
- the Buy/Sell marketplace pages localize filters, selectors, sort options, KYC notices, guided tours, separate buyer/seller instructions and FAQs; shared ad cards localize canonical tag labels, trade/price/limit/detail labels, presence and joined-date labels, while active-trade cards localize roles, known statuses and actions; stored filter identifiers, payment methods, terms, user labels, price calculations and escrow behavior are unchanged;
- arbitrary server-returned error details remain in the language returned by the API, because this client pass does not safely infer or overwrite server semantics;
- other app routes remain untranslated, including public search/discovery routes and other public information pages; public trader profiles (`/users/[username]` and `/user/[username]`), the public active-offers list (`/ads`), public advertisement details and the reusable trade-initiation modal are now partially localized, as are the trade-room details/chat route and shared components, while marketplace Buy/Sell listings, shared offer/active-trade cards and the trade-history page also have partial localization;
- no standalone AML/CFT policy route or verified policy body is present, so no unsupported AML/CTF compliance claims have been published;
- an inspection of 87 app route `page.tsx` files previously found 3 that directly invoked `useI18n`; the direct-transfer, notifications, my-tickets, my-ads, ads/create, ads/edit, buy, sell, trades, trade-room detail, public `/ads` listing and compact `/user/[username]` route have since added it, bringing the directly identified route set to 15 (home, dashboard, unified-wallet, direct-transfer, notifications, my-tickets, my-ads, ads/create, ads/edit, buy, sell, trades, trade-room detail, public ads listing and compact public user profile). The full `/users/[username]` profile localizes through its client component; shared localized components cover additional route content. This does not establish route-wide coverage;
- automatic system-event templates render in the selected language when saved event type and metadata are available; legacy system messages without structured event metadata retain their original text;
- user-authored trade chat remains separate and is not machine-rewritten. User-entered dispute reasons, issue details, and feedback comments remain unchanged inside localized system-event wrappers.

The locale context updates HTML `lang` and Arabic RTL direction. Broader page-by-page localization, API-generated message localization, full legal translation and a verified AML/CFT policy remain open. Public trader profiles, the compact user-status page and public active-ad listing now localize headings, badges, offer summaries, feedback filters, presence and known empty states; public ad detail and trade-initiation labels, known local validation, offer/method headings, trader metrics and presence/date formatting are also partially localized. Trade-room detail/chat labels, known local action messages, evidence controls, presence and timers are partially localized. Marketplace route labels/guides and trade-history controls/status labels are also localized; provider/server error details, official country/currency names, supported payment-network names, user-entered offer terms and arbitrary user-generated content remain as supplied. Notification bodies, user-authored ticket messages, administrator replies and trade-chat messages should not be rewritten by this client localization pass.

## Dependency advisory status

A live `npm audit --json` was attempted but produced no registry response before being stopped. Dependency vulnerabilities therefore remain **unverified in this pass**. The dependency report from older checkpoint documents is historical and must not be treated as the current lockfile result.

## Required release gates still open

1. Reconcile all 182 local migrations with the 81-entry production history and identify production-only schema changes before applying anything.
2. Design and validate the canonical withdrawal request, idempotency, paired-record, ledger, worker fencing, broadcast, settlement, and refund contract against the actual production schema in an isolated disposable database.
3. Validate the corrected user-metadata hardening migration and the new advisor migration against an isolated copy; then deploy through a reviewed migration path.
4. Review every remaining authenticated SECURITY DEFINER function's in-body authorization and all overloads/caller routes; do not use blanket revoke as a substitute.
5. Complete full source/branch/history/deployment secret scanning and verify external provider keys and webhook signing secrets without printing their values.
6. Complete secure field-level encryption/key management for any sensitive persisted data that requires it; confirm TLS, cookie, session, CSRF, rate-limit, and upload protections.
7. Complete reviewed translations for all active locales across remaining app pages and API-generated messages where safely localizable, full Terms and Privacy clauses, a verified AML/CFT policy, and policy/legal errors and notices. Dashboard and unified-wallet labels, deposit/withdraw/transfer dialogs, shared transfer history, direct-transfer page, notifications inbox, support-ticket history, My Ads management, create/edit advertisement forms, Buy/Sell marketplace pages, public trader-profile and public active-ad listing pages, public ad detail and trade-initiation surfaces, shared offer/active-trade cards, trade-history controls and trade-room detail/chat interfaces are partially localized; broader app coverage remains incomplete. Preserve original notification bodies, user ticket messages, administrator replies, seller-authored terms, moderator notes, feedback comments and human-authored trade messages.
8. After the user authorizes it, run the deferred build/type/security/dependency/database integration/smoke/end-to-end checks, fix findings, and repeat until clean.
9. Only after release gates are met: review the precise diff, commit only intended files, deploy, and verify deployment health.

## Final determination

**NOT COMPLETED. NOT LAUNCH-READY.**
The changes in this checkpoint improve local security posture but do not make production safe to launch. Production withdrawals remain contract-incompatible, the migration histories are unreconciled, localization is incomplete, current dependency advisories are unavailable, and the requested tests were intentionally not run.
