-- Migration: 20261002015000_remove_legacy_trade_escrow_trigger.sql
-- Description: Removes legacy trade escrow trigger trg_trade_escrow_process on public.trades
-- while preserving public.process_trade_escrow() function and public.wallets table intact.

DROP TRIGGER IF EXISTS trg_trade_escrow_process ON public.trades;
