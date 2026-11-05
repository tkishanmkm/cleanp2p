CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_trade_settlement_reference_uidx
ON public.ledger_entries (reference_id)
WHERE reference_id LIKE 'trade_rel_seller:%'
   OR reference_id LIKE 'trade_rel_buyer:%'
   OR reference_id LIKE 'trade_can:%';