# Autonomous Development Operating Model

## Goal
Run routine engineering work end-to-end with minimal interruption: inspect -> plan -> implement a small change -> run relevant checks -> inspect failures -> retry/fix -> rerun checks -> summarize evidence. Never report completion based on intent alone.

## Required agent loop
1. Read `AGENTS.md`, this file, the task, repository status, and relevant code/tests before changing anything.
2. Establish a baseline. Record branch, dirty files, test outcomes, and whether secrets or production endpoints are configured. Never overwrite pre-existing user changes.
3. Break work into small, reversible tasks. Prefer a separate feature/fix branch; do not commit, push, merge, deploy, or alter Supabase remotely unless the task explicitly authorizes that specific action.
4. For each change, add/update a regression test where practical. Run the narrow test first, then typecheck, lint, relevant unit tests, E2E, build, and dependency/security checks as applicable.
5. If a check fails, inspect its actual output, identify the cause, make a minimal correction, and rerun the failed check. Retry a bounded maximum of 3 times per failure class; after that, document the blocker rather than looping indefinitely.
6. Verify the diff (`git diff --check`, `git diff`, `git status`) and ensure no secrets, `.env*`, credentials, private keys, seed phrases, generated reports, or unrelated changes are included.
7. Report only verified outcomes: changed files, exact checks and pass/fail results, remaining issues, and whether anything was committed/pushed/deployed.

## Free-tier and cost guardrails
- Prefer local tooling and free/community editions already installed. Keep any external service within its existing free-tier quota; check current provider terms before enabling a new service.
- Do not add paid subscriptions, paid trials, metered API keys, paid scanners, paid CI runners, or paid cloud resources without explicit user approval.
- Do not configure an OpenAI API key for Codex as a workaround; use the user's existing ChatGPT-authenticated access only if available, and respect its usage limits. Never assume unlimited requests or background automation.
- If a task would exceed a free quota, require billing, or cause a paid upgrade, stop and report the blocker rather than enabling billing.

## Default autonomy permissions
- May autonomously inspect source, add tests, edit application code in the working branch, run local static analysis, and use local test fixtures.
- May automatically retry transient local checks within the bounded retry policy.
- Must not access or change production funds, user balances, withdrawals, sweeps, broadcasts, live trades, production database rows/schema/policies, DNS, billing, secrets, or deployment settings as an assumed part of a task.
- Must not exploit a third-party security flaw or bypass another user's authorization. For external sites, use official APIs, public availability, authorized accounts, and permitted booking flows only.
- Use disposable Supabase projects, mocked RPCs, local fixtures, and test-chain funds for financial-flow tests. Fail closed if the target environment cannot be confidently identified as test/staging.
- Do not run `npm audit fix --force` or broad major-version upgrades without an evidence-based migration plan.
- Never disable a failing test or weaken a security rule merely to obtain a green build.

## Quality gates in this repository
Run from the repository root:

```powershell
.\scripts\agentic-quality-gate.ps1
```

This creates a timestamped local report under ignored `local-audit-logs/`. It runs typecheck, lint, browser E2E, production build, and `npm audit --audit-level=high`. Some checks may fail while known issues remain. It deliberately does not run `test:all`, blockchain workers, withdrawal/sweep/broadcast flows, or database-mutating tests because their external side effects must be reviewed and isolated first.

## Continuous automation
- `.github/workflows/quality-security.yml` is configured for pushes, pull requests, manual `workflow_dispatch`, and a daily scheduled run. These triggers become active only after the workflow is committed and pushed to GitHub (scheduled runs normally use the default branch). CI detects regressions; it does not autonomously repair code by itself.
- `scripts/run-autonomous-task.ps1 -Task "..."` starts Codex CLI in the repository's `workspace-write` sandbox, injects these guardrails, records a transcript, and captures the final response. It does not commit, push, merge, deploy, or touch production services.
- Codex CLI is installed at the WinGet links location and currently reports **Logged in using ChatGPT**. However, recent runs still report `sandbox: read-only` and execution-policy rejections despite requesting `--sandbox workspace-write`; unattended code editing is therefore not verified active. Do not use dangerous unrestricted flags as a workaround and do not store an API key in project files.
- After authentication, start a task with a clear acceptance criterion, for example: `& .\scripts\run-autonomous-task.ps1 -Task 'Fix the existing TypeScript errors in small batches, add regression tests, and rerun typecheck after each batch. Do not commit or push.'`
- A truly hands-off schedule also needs a trusted task queue/trigger, stable authentication, machine uptime, CI permissions, branch protections, and monitoring. Do not run unattended production deployments or financial operations. Never claim unattended repair is active until a real task completes and is independently verified.

## Definition of done
A task is done only when its acceptance criteria are met, relevant tests pass, the diff is reviewed, no unresolved high-severity issue is hidden, and the final report states any limitations. A passing lint or CI run alone does not establish financial security or production readiness.
