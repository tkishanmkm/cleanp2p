# Paxones Autonomous Production-Readiness Task

Work through the repository's production-readiness backlog end-to-end in small, verified batches. Read `AGENTS.md`, `docs/AUTONOMOUS-AGENT.md`, `docs/TESTING-TOOLCHAIN.md`, the current git diff, and any existing progress report first. Preserve all pre-existing user changes.

## Prioritized work
1. Establish a fresh baseline and document current branch, dirty files, test failures, and environment assumptions.
2. Fix existing TypeScript errors in minimal batches. Add regression coverage and run typecheck after each batch.
3. Diagnose the local Next.js route/E2E startup timeout. Fix the actual root cause without hiding test failures or unnecessarily changing the UI.
4. Triage npm/Trivy findings by reachability and severity. Patch safe compatible dependency versions where justified; avoid blind force upgrades and major-version migrations.
5. Audit authentication, authorization, RLS, RPCs, and input validation for wallet/deposit/withdrawal/sweep/broadcast/transfer/escrow/trade/ad flows. Use static inspection and isolated fixtures only; add tests for authorization, idempotency, concurrency, replay, amount precision, and banned/restricted users where appropriate.
6. Audit ads create/edit/detail routes and other exposed public APIs for auth, validation, ownership, and error handling.
7. Expand automated tests to cover important regressions. Never run live blockchain transactions or financial-state mutations against production.
8. Rerun applicable local quality gates and review `git diff --check`, changed files, secret exposure, and final repository status.

## Operating rules
- Free-tier-only constraint: prefer local/free/community tools and existing free-tier allowances. Do not add paid subscriptions, metered API keys, paid scanners/runners, paid cloud resources, paid trials, or enable billing. If a free quota or permission blocks progress, record the blocker and stop that route. Do not assume unlimited usage or silently upgrade Supabase, Backblaze, Google AI, GitHub, or other providers.
- Make progress without asking for routine decisions. Choose the safest small implementation consistent with existing architecture and document assumptions.
- Never guess schema or production configuration. Inspect migrations/types/source. If required facts are missing, add safe tests or document the blocker.
- Never access or mutate production Supabase, production user balances, live wallets/private keys/seed phrases, real withdrawals, sweeps, broadcasts, escrow releases, or real trades. Use mocks, disposable staging, and test-chain funds only.
- Never exploit third-party systems, bypass another person's authorization, scrape private data, or use a security bug to take a ticket/reservation/account/resource.
- Do not commit, push, merge, deploy, change DNS/billing, or alter secrets. Do not weaken/remove tests or security rules to obtain a green result.
- Run only tests whose external side effects are understood and isolated. Skip dangerous integration tests if their target cannot be proven non-production.
- For each batch, update `docs/AUTONOMOUS-PROGRESS.md` with the changes, exact tests and results, remaining blockers, and next task. Retry a failure at most three times per failure class, then move to another independent task and record the blocker.
- Continue through as many safe batches as practical in this run. If work remains due to session/time limits, leave `docs/AUTONOMOUS-PROGRESS.md` ready for a continuation. Never claim the site is production-ready unless critical checks and financial/security tests actually pass.

## Completion criteria
A task area is complete only when relevant tests pass and the code review supports the claim. The overall platform is not production-ready while critical/high security issues, unexplained financial-accounting risks, failed builds/typechecks, untested production migrations, or unverified wallet flows remain. End with a factual report and explicit incomplete items.