CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_trade_expiry_refund_ref_uidx
ON public.ledger_entries (reference_id)
WHERE reference_id LIKE 'trade_expiry_refund:%';