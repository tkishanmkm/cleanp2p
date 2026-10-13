# Step 33 — Deployed send-email Edge Function Authorization Review

Date: 2026-10-14
Project: eaiwgfxoiwxepinvcykg

## Observed deployed configuration

- Function: `send-email`
- Status: ACTIVE, version 11
- `verify_jwt: false`
- Application code requires a shared secret from `EMAIL_FUNCTION_AUTH_SECRET`; accepts it from `x-email-function-secret` or as a Bearer token.
- SMTP host/port/user/password/from must be configured.
- Payload validates recipient email, subject length, and HTML length.
- CORS allows any origin (`Access-Control-Allow-Origin: *`).
- The same secret variable name, `EMAIL_FUNCTION_AUTH_SECRET`, is used by the deployed `exec-sql` endpoint from Step 32.

## Findings

### 1. Shared authorization secret across unrelated high-impact endpoints

Both deployed functions use `EMAIL_FUNCTION_AUTH_SECRET`. Because `exec-sql` accepts arbitrary SQL, sharing the same credential expands the impact of a compromise of the email secret. This source review does not establish that the secret has been exposed, but separation of credentials is strongly recommended.

### 2. JWT verification disabled, with custom-secret authorization

The function is not protected by Supabase's gateway JWT verification. The custom secret check is the application-level gate. This can be acceptable for a narrowly scoped service-to-service endpoint if managed securely, but it requires strong secret storage, rotation, narrow caller access, and monitoring. A custom shared secret should not be treated as equivalent to end-user authentication/authorization.

### 3. Broad CORS and arbitrary recipient/content

The endpoint accepts a caller-supplied recipient, subject, and HTML body, up to 100,000 characters, and allows any origin. CORS is not authentication, but broad CORS unnecessarily expands browser-origin reach. If the secret is compromised, the endpoint could be abused to send arbitrary messages to arbitrary recipients, subject to SMTP limits. The reviewed source has no application-level rate limit or recipient allowlist.

### 4. Operational observability

The function logs recipient email and message ID. Consider minimizing personally identifiable data in logs and adding rate-limit/abuse monitoring. SMTP transport enforces TLS certificate validation.

## Recommended remediation

1. Rotate and separate credentials for email delivery and SQL operations through a controlled secret-management process; never paste secrets into chat or repository.
2. Remove the arbitrary-SQL endpoint if not strictly needed; otherwise replace it with narrow, allowlisted operations and a database role with least privilege.
3. Prefer JWT verification plus service-role/claim validation where compatible with the caller architecture, or use a dedicated high-entropy service secret with strict rotation and caller restrictions.
4. Restrict CORS to known origins if browser callers are required; for server-to-server use, consider no browser CORS.
5. Add rate limiting, payload quotas, recipient/domain policy as appropriate, and abuse alerts.
6. Test missing/incorrect credentials, malformed payloads, oversized input, SMTP failure handling, and abuse limits in staging.
7. Verify deployed configuration and audit logs before considering remediation complete.

## Limits / safety

Read-only source inspection only. No emails sent, secrets read or printed, configuration changed, deployment performed, or database rows accessed. No tests were run. The function's actual caller set and whether the shared secret is exposed remain unknown.

Status: requires remediation planning before production launch.
