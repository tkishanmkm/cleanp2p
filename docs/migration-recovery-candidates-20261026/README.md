# Migration recovery candidates — 2026-10-26

These files are quarantined research copies, not production-verified migrations. Their names match production migration descriptions and the source commits are reachable in local Git history, but their SQL bodies have NOT been proven byte-for-byte identical to the SQL executed in production. They are deliberately stored outside `supabase/migrations` so migration tooling will not treat them as pending migrations. Do not rename, apply, or deploy without authoritative provenance verification.

| Production version | Name | Source commit | Source path | Source Git blob |
|---|---|---|---|---|
| 20261011160153 | wallet_hardening_followup | b64609206f1c920e6bd1a588cc1ed02ea219eada | supabase/migrations/20261011170000_wallet_hardening_followup.sql | dcc442887a50cb4c2fbfe44d3f3f075a79f83fc1 |
| 20261011160335 | wallet_deposit_rpc_restrictions | 9b22d39a9ca6c069479d1fc98bb503793354c66e | supabase/migrations/20261011171000_wallet_deposit_rpc_restrictions.sql | d12974fa4521d3334bc4208324b343636a081583 |
| 20261011160457 | wallet_legacy_deposit_overload | 8c6af9025087b0e09b66257a91a97e8ce5252d4e | supabase/migrations/20261011172000_wallet_legacy_deposit_overload.sql | e3b56fe02cb5f146811bfaad7cb4e9dd06385aea |
| 20261011161643 | secure_wallet_provisioning_trigger | c414cb33c6a2df51b6a8929413da72f66d52498b | supabase/migrations/20261011173000_secure_wallet_provisioning_trigger.sql | 112df79b2b0568d56f643801978df7eb124a3db7 |
| 20261011161817 | enforce_atomic_withdrawal_limits | 0a652b8e04c0029977c87714a0d232fd00cfce3b | supabase/migrations/20261011174000_enforce_atomic_withdrawal_limits.sql | 5ee921d4444adfd842a8c41b2962306a48882867 |
| 20261011163228 | restrict_wallet_lock_functions | 68af546acca47b0edbae7b3a1034c9f0cf521d0e | supabase/migrations/20261011175000_restrict_wallet_lock_functions.sql | 10e0bba7e341048f7dcd11c348f8a995c491516a |
| 20261011163807 | fix_wallet_transfer_search_path | d11c20f5b6efbcdeef53ca959bb75d4472f379c9 | supabase/migrations/20261011164000_fix_wallet_transfer_search_path.sql | 78410acd4b031e032e4bd941cf8a073a0238eed0 |
