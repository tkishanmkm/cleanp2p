-- ============================================================================
-- Supabase Migration: 20260903000004_add_needs_approval_to_onchain_withdrawals.sql
-- Description: Allow NEEDS_APPROVAL status and add approval audit columns
-- ============================================================================

-- 1. Modify the check constraint on onchain_withdrawals to allow NEEDS_APPROVAL
DO $$
BEGIN
    ALTER TABLE public.onchain_withdrawals 
        DROP CONSTRAINT IF EXISTS onchain_withdrawals_status_check;

    ALTER TABLE public.onchain_withdrawals 
        ADD CONSTRAINT onchain_withdrawals_status_check 
        CHECK (status IN ('NEEDS_APPROVAL', 'PENDING', 'PROCESSING', 'BROADCASTED', 'CONFIRMED', 'COMPLETED', 'FAILED', 'CANCELLED'));
END $$;

-- 2. Add approved_by and approved_at columns if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'onchain_withdrawals' AND column_name = 'approved_by'
    ) THEN
        ALTER TABLE public.onchain_withdrawals ADD COLUMN approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'onchain_withdrawals' AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE public.onchain_withdrawals ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_onchain_withdrawals_needs_approval 
    ON public.onchain_withdrawals(status) 
    WHERE status = 'NEEDS_APPROVAL';
