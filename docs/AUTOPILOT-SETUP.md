# CleanP2P Autopilot Setup

## Purpose
The one-click Windows launcher installs the exact lockfile dependencies when required, then runs TypeScript, lint, production dependency audit, and production build checks and writes timestamped logs plus a JSON summary under `local-audit-logs/`.

## Start
Open `START-CLEANP2P-AUTOPILOT.bat` in File Explorer. This is the one-time/manual launch needed because a repository cannot execute software on your PC without your permission. It uses the existing local checkout and does not require GitHub Actions minutes.

## Safety defaults
- Does not deploy, push, change Supabase, alter balances, broadcast transactions, or auto-apply database migrations.
- Does not use `npm audit fix --force`; breaking dependency upgrades need a reviewed change and a fresh test run.
- Integration tests are skipped by default. Enable them only with a dedicated disposable test Supabase project and all three environment variables: `TEST_SUPABASE_URL`, `TEST_SUPABASE_SERVICE_ROLE_KEY`, and `TEST_ALLOW_DESTRUCTIVE_P2P_TESTS=true`.
- Never put service-role keys, private keys, seed phrases, or production secrets in Git or the report.
- A passing build is not a financial/security sign-off. Escrow, wallet accounting, withdrawal/broadcast, access control, RLS and recovery need separate code/database review and test evidence.

## What it does not do
This runner collects reproducible local evidence; it does not use an AI API to invent/apply code fixes. ChatGPT can review and patch the repository through the connected GitHub integration, but fully unattended AI edits require a separately configured, permissioned agent/API and must be constrained to a non-production branch. GitHub Actions currently cannot be relied on while the account quota is exhausted.
