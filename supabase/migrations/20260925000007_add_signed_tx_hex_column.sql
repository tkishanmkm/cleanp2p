-- ============================================================================
-- Supabase Migration: 20260925000007_add_signed_tx_hex_column.sql
-- Description: Blocker #4 Durability - Add raw signed transaction hex column
--              Adds nullable signed_tx_hex column to public.sweep_operations table.
-- ============================================================================

BEGIN;

-- Add raw signed transaction hex storage column safely
ALTER TABLE public.sweep_operations
ADD COLUMN IF NOT EXISTS signed_tx_hex TEXT DEFAULT NULL;

COMMIT;
