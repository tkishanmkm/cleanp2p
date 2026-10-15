-- Prevent duplicate financial ledger rows for canonical trade settlement actions.
-- Existing duplicate check was run before applying this migration and returned none.
-- If an insert conflicts, the enclosing PostgreSQL transaction rolls back the
-- associated wallet/trade mutations instead of allowing an unledgered settlement.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_trade_settlement_reference_uidx
ON public.ledger_entries (reference_id)
WHERE reference_id LIKE 'trade_rel_seller:%'
   OR reference_id LIKE 'trade_rel_buyer:%'
   OR reference_id LIKE 'trade_can:%';
