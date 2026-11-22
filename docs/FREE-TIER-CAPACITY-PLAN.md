# Paxones Supabase Free-Tier Capacity Plan

Status: planning baseline only; this is not a load-test result or a production capacity guarantee.

## Target and constraints

- Target: 1,000 monthly active users (MAU) for a limited beta.
- Design limits prepared in code/migrations: at most 20 active ads per user, 20 rows per trade-list response, 100 human chat messages per trade, 30-day retention for notifications, and deletion of chat messages 30 days after a terminal trade.
- Realtime chat subscriptions should only run while the trade is active. Terminal trade history remains readable, but should not maintain a live subscription.
- Keep profile pictures and trade attachments in Backblaze B2 rather than storing binary files in Postgres.
- The database migrations in this plan are still local-only and require isolated PostgreSQL validation before deployment.

## Conservative monthly usage budget

Supabase Free's published limits in the project notes are 50,000 MAU, 500 MB Postgres database, 2 million Realtime messages, and 5 GB cached plus 5 GB uncached egress. A 1,000-MAU target is below the MAU allowance, but MAU alone does not predict database, egress, or Realtime use.

Use the following initial operational budget, not as a guarantee:

| Measure | Initial budget | Why |
|---|---:|---|
| MAU | 1,000 | Beta target, below the published MAU allowance |
| Completed/cancelled trades | Aim for <= 1,000/month until measured | At the 100-message maximum, this means <= 100,000 logical human messages/month |
| Human chat messages | <= 100 per trade | Enforced by the prepared database trigger after migration validation |
| Realtime messages | Alert at 50% (1 million) and freeze nonessential subscriptions before 75% (1.5 million) | Keeps headroom below the 2-million monthly quota |
| Database size | Alert at 60% (300 MB); review retention/indexes at 70% (350 MB) | Leaves space for financial rows, indexes, and growth within 500 MB |
| Egress | Alert at 60% of each 5 GB bucket | Avoids discovering usage problems at the quota edge |
| Notifications | Keep 30 days | Old notifications are not needed indefinitely |
| Terminal-trade chat | Purge 30 days after completion/cancellation/expiry, excluding disputes | Limits stored chat growth while preserving active/disputed evidence |

### Realtime estimate

For a conservative worst case, assume a logical chat message causes two database-table events and both buyer and seller receive each event: roughly four Realtime deliveries per logical message. At 100,000 logical messages/month this is about 400,000 deliveries, before status changes and other subscriptions. At 500,000 logical messages it could approach 2 million deliveries. The actual count must be measured in the Supabase dashboard because channel subscriptions, legacy paths, status changes, and other features add traffic.

## Required operating controls

1. Do not subscribe to chat for completed, cancelled, expired, or otherwise terminal trades.
2. Paginate all user/admin lists; never load unbounded trades, notifications, or ads into the browser.
3. Keep attachments and profile images in B2; impose file-size and MIME limits at upload time.
4. Run daily retention jobs only after their migrations are validated; preserve disputed trade evidence and never purge a trade with an open dispute.
5. Add quota monitoring and a documented incident response before public launch. At 50% Realtime/database usage, reduce nonessential refreshes; at 75%, pause nonessential realtime features and investigate.
6. Load-test with synthetic users and test trades, never real deposits/withdrawals, before allowing 1,000 users.
7. Test migration rollback and restore procedures. Do not rely on an untested free-tier database as the sole source of truth for real customer funds.

## Production warning

Passing TypeScript, lint, and a Next.js build does not prove capacity or security. The current dependency audit still has a critical Next.js advisory and high/moderate findings; the prepared SQL migrations have not been applied or engine-tested; and OWASP ZAP scanning and end-to-end wallet/escrow tests remain incomplete. Use the free tier for development or a tightly limited test beta only. Do not custody real crypto or promise uninterrupted financial service until those blockers are resolved and backups, incident response, and financial-operation reconciliation are tested.
