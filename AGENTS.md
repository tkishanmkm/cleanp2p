# Engineering Principles & Architecture Guidelines

## 1. Database & PostgreSQL (Supabase)
- **Strict Data Typing:** Never mix `uuid` and `text` types in joins, comparisons, or RLS policies. Always use explicit type casts (e.g. `col::uuid` or `col::text`) to prevent operator mismatch errors (PostgreSQL Error 42883).
- **Row Level Security (RLS):** Every table must have RLS enabled with explicit policies for `SELECT`, `INSERT`, `UPDATE`, and `DELETE`. Ensure `auth.uid()` comparisons match the column's data type.
- **Foreign Keys & Referential Integrity:** Maintain referential integrity across related tables (`trades`, `profiles`, `messages`, `wallets`, `transfers`) with appropriate `ON DELETE CASCADE` or `SET NULL` actions.

## 2. Backend & API Services
- **Defensive Error Handling:** Return raw, clear error structures with error codes and descriptions while safeguarding secrets.
- **Input Validation:** Enforce schema validation (Zod, TypeScript interfaces) and verify authentication and role permissions before executing transactions.
- **Decoupled Architecture:** Keep business logic cleanly organized in dedicated library modules and service helpers rather than coupling tightly to raw route handlers.

## 3. Frontend & Client Integration
- **Async State Management:** Gracefully handle loading indicators, empty states, network retries, and error boundaries.
- **Client Schema Validation:** Ensure data payloads strictly match backend types prior to sending requests to Supabase or internal API endpoints.

## 4. Code Output & Craftsmanship
- Provide clean, production-grade, defensive TypeScript and SQL code.
- Add explanatory notes for critical type conversions, concurrency safety, and transaction atomicity.


## 5. Free-tier and cost controls
- Use local tools and free/community editions wherever practical; respect existing free-tier quotas and rate limits.
- Do not add paid subscriptions, metered API keys, paid scanners, paid CI runners, paid cloud resources, paid trials, or enable billing without explicit user approval.
- Do not use an API key or dangerous sandbox bypass to work around Codex/ChatGPT limits. If the free allowance or permissions block progress, report the limit and stop that route.
- Never claim a service is free or unlimited without checking its current terms. Do not silently upgrade Supabase, Backblaze, Google AI, GitHub, or any other provider.

## 6. Autonomous execution and verification
- Follow `docs/AUTONOMOUS-AGENT.md` for every non-trivial task. Work from evidence, make small reversible changes, add regression tests, and verify the final diff.
- Do not stop after describing a fix: implement and test it when the task and permissions allow. If a check fails, diagnose the actual output, fix the root cause, and rerun; cap retries at three per failure class and report any blocker.
- Run `scripts/agentic-quality-gate.ps1` for the local quality gate. It captures results under ignored `local-audit-logs/` and exits nonzero if any configured check fails.
- Never claim a task is complete without reporting exact test outcomes. Never commit, push, merge, deploy, or modify production Supabase/financial state unless that exact action is authorized.
- Do not test wallet balances, deposits, withdrawals, sweeps, broadcasts, escrow releases, or live blockchain transactions against production. Use isolated staging projects and test-chain funds.
- Never bypass another user's authorization, exploit a third-party system, expose credentials, or disable a failing security check just to make CI green.
