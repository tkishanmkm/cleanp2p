-- Add indexes for foreign-key columns reported by Supabase's database linter.
-- These indexes support joins/deletes and common reconciliation/sweeper lookups.
-- Prepared locally only; review and apply through the normal migration process.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_deposits_user_id
    ON public.deposits (user_id);

CREATE INDEX IF NOT EXISTS idx_platform_ledger_entries_related_user_id
    ON public.platform_ledger_entries (related_user_id);

CREATE INDEX IF NOT EXISTS idx_profiles_emergency_frozen_by
    ON public.profiles (emergency_frozen_by);

CREATE INDEX IF NOT EXISTS idx_sweep_queue_user_id
    ON public.sweep_queue (user_id);

CREATE INDEX IF NOT EXISTS idx_utxo_reservations_sweep_id
    ON public.utxo_reservations (sweep_id);

COMMIT;
