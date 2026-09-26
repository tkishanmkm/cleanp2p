-- ============================================================================
-- Supabase Migration: 20260925000006_add_sweep_nonce_column.sql
-- Description: Blocker #4 Schema Alignment - Add missing sweep operations nonce column
--              Adds nullable EVM nonce column to public.sweep_operations table.
-- ============================================================================

BEGIN;

-- Add the missing nullable nonce column safely
ALTER TABLE public.sweep_operations
ADD COLUMN IF NOT EXISTS nonce BIGINT DEFAULT NULL;

COMMIT;
