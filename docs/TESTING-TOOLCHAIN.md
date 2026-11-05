# Test Toolchain

## Installed / configured
- Playwright Test with Chromium for browser automation.
- axe-core Playwright integration for automated WCAG 2 A/AA checks on the login page.
- ESLint security rules for dangerous eval usage, unsafe regular expressions, child-process calls, non-literal filesystem paths, and object-injection patterns.
- Trivy for dependency vulnerability, configuration, and secret scanning; local report output is kept under the ignored `local-audit-logs/` directory.
- Browser smoke tests are in `e2e/` and deliberately do not submit trades, initiate withdrawals, modify balances, or touch production data.
- `playwright.config.ts` defaults to local `http://127.0.0.1:3000`; set `TEST_APP_URL` to point at an explicitly authorized staging/test instance.
- GitHub Actions workflow `.github/workflows/quality-security.yml` runs typecheck, lint, dependency audit, and browser smoke tests on pushes/pull requests.

## Security-tool boundaries
- Burp Suite Community Edition is for manual proxy/repeater testing and does not include all Professional automated scanning features or the Professional REST API. Keep it on loopback and only test systems you own or are authorized to assess.
- Codex CLI is installed locally but is a separate tool; it does not automatically connect to this ChatGPT conversation. It may require its own sign-in.
- Never run withdrawal, sweep, broadcast, or balance-mutating tests against production. Use a disposable Supabase project and test-chain funds for integration tests.
- CI uses placeholder public Supabase settings, not production secrets. Do not commit `.env.local`, service-role keys, API keys, private keys, or seed phrases.
- Dependency audit findings must be triaged; a failed audit is evidence of outstanding risk, not a reason to force-upgrade dependencies blindly.
- Semgrep itself is not configured because native Windows support is limited and neither Docker nor WSL was installed. Trivy, TypeScript, ESLint security rules, npm audit, and Playwright provide the current layered baseline. WSL/Docker installation would require a separate OS-level setup.

## Financial integration-test safety gate
- Mutating Supabase integration tests now import `tests/helpers/test-supabase.ts` and require `PAXONES_TEST_SUPABASE_URL`, `PAXONES_TEST_SUPABASE_SERVICE_ROLE_KEY`, and `PAXONES_TEST_DB_ALLOW_MUTATIONS=1` explicitly.
- The helper refuses the known `paxonesflows` production project and placeholder configuration. Do not reuse production service-role credentials in test environments.
- Financial integration tests set a nonzero exit code when the expected assertions do not all pass; a printed failure must not be reported as a passing process.
- The current `cleanp2p-staging` Supabase project is empty, so it is not yet a runnable integration-test target. These tests should remain blocked until a disposable schema and test-chain setup are available.
