# Step 34W — Schema counts

Read-only comparison.

- Production public schema: 80 tables, 200 routines, 42 triggers, 118 policies, 269 indexes.
- Staging public schema: 0 tables, 0 routines, 0 triggers, 0 policies, 0 indexes.
- Production migration listing returned 12 records; staging returned none.
- Repository contains 108 SQL migration files, so a complete historical replay is not verified as a reconstruction method.
- Known drift: historical on-chain deposit migration uses a single-column tx_hash uniqueness definition, while live identity uniqueness is composite and normalized.
- Staging is not ready for financial integration tests. Do not replay migrations in bulk. Prepare a reviewed schema-only baseline, inspect privileged routines/triggers and environment-specific jobs, compare catalog definitions, and test deposit verification on staging before any production change.
- No schema changes were applied. Deposits remain NOT READY for production.
