-- Enforce one expiry-refund ledger entry per trade. The expiry routine locks
-- and transitions the trade atomically, while this index is a database-level
-- idempotency backstop against future code paths or accidental replays.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_trade_expiry_refund_ref_uidx
ON public.ledger_entries (reference_id)
WHERE reference_id LIKE 'trade_expiry_refund:%';
