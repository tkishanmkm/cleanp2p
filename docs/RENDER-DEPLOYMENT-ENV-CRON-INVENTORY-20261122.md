# WAYONES Render deployment, environment and cron inventory

**Captured:** 2026-11-22
**Repository:** `tkishanmkm/cleanp2p`
**Branch:** `main`
**Pushed commit at capture:** `038cd1120e153d27ecc75afed15fde0f1206a8c0`

## 1. Deployment status

- Render service: `nextoness` (`srv-dbnqvajl550s73fv69sg`)
- Repository / branch: `tkishanmkm/cleanp2p` / `main`
- Runtime: Node web service, Singapore, free plan
- Build command: `bun install --frozen-lockfile && bun run build`
- Start command: `bun run start`
- Auto deploy: enabled on commit
- Service state: **SUSPENDED by owner**
- Last recorded deploy: `dep-dbnqvb3l550s73fv6c80`, **build_failed**, 2026-11-07, commit `e73d2a997e338c386032bce7547a123d0952a5ee`
- Post-push check: no deploy for `038cd112` was created; the service remains suspended.
- No Render background worker or Cron Job for `cleanp2p` was found in the workspace inventory.
- The currently configured Render environment-variable names/values could not be read with the available Render connection. Do not interpret this source/template inventory as proof that the variables are configured in Render.

**Important:** A Git push is complete, but a Render deployment is not. The service must be explicitly unsuspended, and the new commit must build and pass runtime health checks before it can be called live. No unsuspend or deploy action was performed.

## 2. Environment variable inventory

The `.env.example` template contains **63 names**. A source scan found **109 distinct environment references** across the app, scripts, migrations and workflow configuration. The 109 count includes legacy aliases, optional feature switches and operating-system/runtime names; it does not mean every name is required for every deployment.

### 2.1 All names in `.env.example` (63)

```text
ADMIN_2FA_ENCRYPTION_KEY
USER_2FA_ENCRYPTION_KEY
ALCHEMY_WEBHOOK_SIGNING_KEY
B2_ACCESS_KEY_ID
B2_APPLICATION_KEY
B2_APPLICATION_KEY_ID
B2_BUCKET_ID
B2_BUCKET_NAME
KYC_DATA_ENCRYPTION_KEY
B2_PRIVATE_DATA_ENCRYPTION_KEY
B2_BUCKET_REGION
B2_ENDPOINT
B2_REGION
B2_SECRET_ACCESS_KEY
BLOCKCHAIN_WEBHOOK_SECRET
BSC_RPC_URL
BTC_HOT_WALLET_ADDRESS
BTC_HOT_WALLET_PRIVATE_KEY
BTC_MEMPOOL_API
BTC_NETWORK
BTC_XPUB
WALLET_PROVISIONING_SECRET
CHAIN_INGEST_SECRET
CRON_SECRET
CRON_SECRET_KEY
DEPOSIT_HD_MNEMONIC
DEPOSIT_WORKER_SECRET
DIDIT_API_KEY
DIDIT_API_URL
DIDIT_WEBHOOK_SECRET
DIDIT_WORKFLOW_ID
EMAIL_FUNCTION_AUTH_SECRET
ETH_RPC_URL
EVM_HOT_WALLET_ADDRESS
EVM_HOT_WALLET_PRIVATE_KEY
EVM_RPC_URL
EVM_XPUB
GAS_ORACLE_SECRET
HCAPTCHA_SECRET_KEY
HOT_WALLET_PRIVATE_KEY
HOT_WALLET_PUBLIC_ADDRESS
LTC_HOT_WALLET_ADDRESS
LTC_HOT_WALLET_PRIVATE_KEY
LTC_XPUB
PUBLIC_XPUB_DERIVATION_ENABLED
NEXT_PUBLIC_ALCHEMY_API_KEY
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_HCAPTCHA_SITE_KEY
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SUPABASE_URL
PROVISION_SERVICE_KEY
PUBLIC_PLATFORM_XPUB
SUPABASE_SERVICE_ROLE_KEY
TRON_HOT_WALLET_ADDRESS
TRON_HOT_WALLET_PRIVATE_KEY
TRON_RPC_URL
TRON_XPUB
USDT_CONTRACT_BEP20
USDT_CONTRACT_ERC20
USDT_CONTRACT_TRC20
WITHDRAWAL_WORKER_SECRET
ENABLE_WITHDRAWALS
```

### 2.2 All 109 distinct source environment references

```text
ADMIN_2FA_ENCRYPTION_KEY
ALCHEMY_WEBHOOK_SIGNING_KEY
AWS_ACCESS_KEY_ID
AWS_BUCKET_NAME
AWS_ENDPOINT_URL
AWS_REGION
AWS_SECRET_ACCESS_KEY
B2_ACCESS_KEY_ID
B2_APP_KEY
B2_APPLICATION_KEY
B2_APPLICATION_KEY_ID
B2_BUCKET_NAME
B2_BUCKET_REGION
B2_ENDPOINT
B2_KEY_ID
B2_PRIVATE_DATA_ENCRYPTION_KEY
B2_REGION
B2_SECRET_ACCESS_KEY
BLOCKCHAIN_WEBHOOK_SECRET
BSC_RPC_URL
BTC_CONFLICT_PROOF_API
BTC_FINALITY_API
BTC_HOT_WALLET_PRIVATE_KEY
BTC_MEMPOOL_API
BTC_MEMPOOL_BACKUP_API
BTC_PRIVATE_KEY
BTC_REQUIRED_CONFIRMATIONS
BTC_XPUB
CHAIN_INGEST_SECRET
CRON_SECRET
CRON_SECRET_KEY
DEPOSIT_HD_MNEMONIC
DEPOSIT_WORKER_SECRET
DIDIT_API_KEY
DIDIT_API_URL
DIDIT_WEBHOOK_SECRET
DIDIT_WORKFLOW_ID
EMAIL_FUNCTION_AUTH_SECRET
ENABLE_WITHDRAWALS
ETH_RPC_URL
ETH_SEPOLIA_RPC_URL
EVM_GAS_FUNDING_BUFFER_BNB
EVM_GAS_FUNDING_BUFFER_ETH
EVM_HOT_WALLET_ADDRESS
EVM_HOT_WALLET_PRIVATE_KEY
EVM_RPC_URL
EVM_XPUB
GAS_FUNDING_COOLDOWN_SECONDS
GAS_FUNDING_DAILY_LIMIT_BNB
GAS_FUNDING_DAILY_LIMIT_ETH
GAS_FUNDING_DAILY_MAX_OPS
GAS_ORACLE_SECRET
HCAPTCHA_SECRET_KEY
HOT_WALLET_ADDRESS
HOT_WALLET_BNB_MIN_RESERVE
HOT_WALLET_BTC_ADDRESS
HOT_WALLET_BTC_PRIVATE_KEY
HOT_WALLET_ETH_MIN_RESERVE
HOT_WALLET_LTC_ADDRESS
HOT_WALLET_LTC_PRIVATE_KEY
HOT_WALLET_PRIVATE_KEY
HOT_WALLET_PUBLIC_ADDRESS
HOT_WALLET_TRON_ADDRESS
HOT_WALLET_TRON_PRIVATE_KEY
HOT_WALLET_TRX_MIN_RESERVE
KYC_DATA_ENCRYPTION_KEY
LOCALAPPDATA
LTC_CONFLICT_PROOF_API
LTC_FINALITY_API
LTC_HOT_WALLET_PRIVATE_KEY
LTC_MEMPOOL_API
LTC_MEMPOOL_BACKUP_API
LTC_PRIVATE_KEY
LTC_REQUIRED_CONFIRMATIONS
LTC_XPUB
NEXT_PUBLIC_APP_URL
NEXT_PUBLIC_HCAPTCHA_SITE_KEY
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SUPABASE_URL
NODE_ENV
PAXONES_ATOMIC_ADMIN_BALANCE_ENABLED
PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED
POSTGRES_DB_URL
PROVISION_SERVICE_KEY
PUBLIC_XPUB_DERIVATION_ENABLED
RUN_STANDALONE_WORKER
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
TRON_BACKUP_RPC_URL
TRON_EVENT_SERVER
TRON_GRID_API_KEY
TRON_HOT_WALLET_ADDRESS
TRON_HOT_WALLET_PRIVATE_KEY
TRON_PRIVATE_KEY
TRON_RPC_URL
TRON_USDT_CONTRACT
TRON_XPUB
TRONGRID_API_KEY
TRONGRID_API_URL
USDT_CONTRACT_ADDRESS
USDT_CONTRACT_BEP20
USDT_CONTRACT_ERC20
USDT_CONTRACT_TRC20
USER_2FA_ENCRYPTION_KEY
WALLET_PROVISIONING_SECRET
WITHDRAWAL_WORKER_SECRET
WORKER_SECRET
```

### 2.3 Configuration groups / deployment notes

- **Browser-visible configuration:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_HCAPTCHA_SITE_KEY`, `NEXT_PUBLIC_ALCHEMY_API_KEY`. Values prefixed `NEXT_PUBLIC_` are exposed to browser code; never put private credentials in them.
- **Supabase/server:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_DB_URL`. Service-role/database credentials must remain server-side.
- **Authentication, webhooks and workers:** `ADMIN_2FA_ENCRYPTION_KEY`, `USER_2FA_ENCRYPTION_KEY`, `HCAPTCHA_SECRET_KEY`, `ALCHEMY_WEBHOOK_SIGNING_KEY`, `BLOCKCHAIN_WEBHOOK_SECRET`, `CHAIN_INGEST_SECRET`, `CRON_SECRET`, `CRON_SECRET_KEY`, `DEPOSIT_WORKER_SECRET`, `WITHDRAWAL_WORKER_SECRET`, `WORKER_SECRET`, `EMAIL_FUNCTION_AUTH_SECRET`, `WALLET_PROVISIONING_SECRET`, `PROVISION_SERVICE_KEY`, `GAS_ORACLE_SECRET`.
- **KYC / storage:** `DIDIT_API_KEY`, `DIDIT_API_URL`, `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`, `KYC_DATA_ENCRYPTION_KEY`, plus the B2/AWS storage variables listed above.
- **Wallet custody / derivation:** `DEPOSIT_HD_MNEMONIC`, `BTC_XPUB`, `EVM_XPUB`, `LTC_XPUB`, `TRON_XPUB`, `PUBLIC_PLATFORM_XPUB`, `HOT_WALLET_*`, `BTC_*PRIVATE_KEY`, `EVM_*PRIVATE_KEY`, `LTC_*PRIVATE_KEY`, and `TRON_*PRIVATE_KEY`. These are highly sensitive. Do not paste them into source files, logs, or chat. Public xpub derivation remains opt-in; `PUBLIC_XPUB_DERIVATION_ENABLED` is false in the template.
- **Network configuration:** EVM/BSC/TRON RPC URLs, BTC/LTC mempool/finality/conflict-proof endpoints, TRON Grid/event configuration, and USDT contract addresses are listed explicitly above.
- **Operational feature flags/limits:** `ENABLE_WITHDRAWALS`, `PUBLIC_XPUB_DERIVATION_ENABLED`, `RUN_STANDALONE_WORKER`, `PAXONES_ATOMIC_ADMIN_BALANCE_ENABLED`, `PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED`, gas funding caps/cooldowns and reserve thresholds.
- `LOCALAPPDATA` and `NODE_ENV` are machine/runtime variables, not secrets to add manually as application credentials.

This list is a source/template inventory, not a central required-variable validator. Confirm feature-by-feature requirements against the current code and configure only the secrets needed for the enabled feature set.

## 3. Application worker intervals and cron schedules

All the following schedules are defined in `src/worker.ts` / worker modules. They run only when the standalone worker daemon is actually started; the current Render web service start command is `bun run start`, which starts Next.js and does not start `src/worker.ts`.

### 3.1 Polling workers

| Worker | Interval | Purpose |
|---|---:|---|
| Deposit ingestion | 30 seconds | Scan/register pending on-chain deposits |
| Confirmation processor | 30 seconds | Verify chain finality and process pending credits |
| Withdrawal queue worker | 15 seconds | Process queued withdrawal work |

### 3.2 node-cron schedules

| Job | Cron expression | Frequency | Notes |
|---|---|---|---|
| P2P expiry | `* * * * *` | Every minute | Expires eligible P2P trades |
| Deposit sweeper | `*/5 * * * *` | Every 5 minutes | Can sign/broadcast sweeps; keep disabled until wallet custody and production DB gates pass |
| Market price updater | `*/5 * * * *` | Every 5 minutes | Refreshes market data |
| Deposit chain integrity monitor | `*/5 * * * *` | Every 5 minutes | Checks post-credit on-chain identity |
| Worker heartbeat | `*/5 * * * *` | Every 5 minutes | Logs worker/db/provider health |
| Hot wallet balance monitor | `*/15 * * * *` | Every 15 minutes | Checks USDT hot-wallet reserve |
| Ledger vs chain reconciliation | `*/15 * * * *` | Every 15 minutes | Compares USDT liability with hot-wallet balance |

The cron expressions are code definitions, not proof that these jobs are currently running.

## 4. Schedulers found during the read-only check

| Scheduler | Current state | Detail |
|---|---|---|
| Render web service `nextoness` | Suspended | No new deploy after the `main` push |
| Render Background Worker for cleanp2p | Not found | No persistent worker service in the workspace inventory |
| Render Cron Job for cleanp2p | Not found | No dedicated Render cron resource found |
| Supabase `pg_cron` | One inactive job | `cancel-expired-p2p-trades-job`, `*/5 * * * *`, `active=false` |
| Windows `CleanP2P-Daily-Autopilot` | Disabled | Intentionally disabled |
| Windows `WAYONES-Autopilot-Health` | Disabled | Intentionally disabled |
| ChatGPT scheduled automations | None | No Cloud automation configured |

## 5. Required next deployment gates

1. Confirm the intended production Supabase project. The connected account has both `paxonesflows` (active/healthy) and `cleanp2p-staging` (inactive); production identity has not been proven.
2. Reconcile the database migration ledger and remote-only migration sources before applying any SQL. Do not run a blanket database push.
3. Confirm and configure the Render environment variables needed for the selected feature set without exposing any values.
4. Unsuspend `nextoness` only when approved. The current recorded deploy failed on 2026-11-07, and the pushed commit has not yet been built.
5. Run the approved local quality gates and deploy rehearsal before enabling any worker process.
6. Do not enable the sweeper, withdrawal worker, or any live signing/broadcast path until wallet custody, DB RPC compatibility, key isolation, and reconciliation gates are complete.

No Render environment values were read or changed. No cron schedule, worker, Supabase migration, production secret, financial operation, or live chain transaction was enabled by this inventory.
