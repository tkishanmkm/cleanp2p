# Deposit chain integrity monitor

The worker checks block identities persisted for already-credited deposits. It is scheduled every five minutes by `src/worker.ts`.

## Provider quorum requirements

A result is conclusive only when at least two distinct HTTPS provider origins return the same block hash at the persisted height. A single provider mismatch, provider disagreement, an unavailable endpoint, a wrong-chain response, or an invalid response is recorded as inconclusive and retried. It must not create a reorganisation alert.

Ethereum and BNB Smart Chain use the distinct provider origins already configured in `SUPPORTED_EVM_CHAINS`:
- Ethereum: `ETH_RPC_URL`, `EVM_RPC_URL`, plus the existing public fallback endpoints.
- BNB Smart Chain: `BSC_RPC_URL`, plus the existing public fallback endpoints.

Configure independent secondary HTTPS endpoints for the other supported chains:
- Bitcoin: `BTC_MEMPOOL_BACKUP_API`; the primary is `BTC_MEMPOOL_API` or the built-in Mempool endpoint.
- Litecoin: `LTC_MEMPOOL_BACKUP_API`; the primary is `LTC_MEMPOOL_API` or the built-in LitecoinSpace endpoint.
- TRON: `TRON_BACKUP_RPC_URL`; the primary is `TRON_RPC_URL` or TronGrid. Both must expose `/walletsolidity/getblockbynum`.

Backup endpoints must be independent origins, point to the same production mainnet, and expose the same block-height lookup contract. Do not configure two URLs from the same host merely to satisfy the quorum check.

## Outcomes and actions

- **MATCH:** two providers agree with the stored hash. The next check is scheduled in one hour.
- **MISMATCH:** at least two providers agree on the same different hash. A durable integrity event and a deduplicated critical system alert are written; manual review is required.
- **INCONCLUSIVE:** there is no two-provider quorum. The check is retried after five minutes and no integrity event or reorganisation alert is created.

The database functions only claim and complete integrity-check leases, record integrity evidence, and raise alerts. They do not modify customer deposit status, wallet balances, ledger rows, transfers, withdrawals, or chain transactions.

The monitor remains dormant until its database migration and the prerequisite deposit block-identity migrations are deployed in order. Do not treat the monitor as operational solely because its application code has been pushed.
