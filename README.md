# Wayones

Wayones is a peer-to-peer digital-asset marketplace with trade escrow workflows, account security controls, and a localized web application.

## Application

- Next.js application in `src/app`
- Supabase-backed authentication and application data
- P2P advertisement and trade workflows
- Background processing entry point: `src/worker.ts`

## Local development

```bash
npm install
npm run dev
```

## Code quality

```bash
npm run typecheck
```

## Database changes

Review the ordered Supabase migration history and the deployment runbook in `docs/deposit-migration-deployment-runbook.md` before applying any migration. Production migrations and financial operations require a separately approved deployment window.

## Release branch

The current hardening work is maintained on `fix/production-typecheck-batch-1`. Changes on that branch are not automatically a production deployment.
