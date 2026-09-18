-- ==============================================================================
-- Migration: 20260918000003_add_feedback_is_positive_and_align_schema.sql
-- Description: 
--   1. Ensures the 'feedback' table exists with all standard columns including 'is_positive'.
--   2. Adds 'is_positive' (BOOLEAN) to the 'feedback' table if it was missing.
--   3. Adds RLS policies and performance indexes.
-- ==============================================================================

-- 1. Create feedback table if it doesn't exist yet
CREATE TABLE IF NOT EXISTS public.feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id UUID REFERENCES public.trades(id) ON DELETE CASCADE,
    from_user UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    from_username TEXT,
    to_user UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
    is_positive BOOLEAN NOT NULL DEFAULT TRUE,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Safely add is_positive and other missing columns to existing feedback table
ALTER TABLE IF EXISTS public.feedback
    ADD COLUMN IF NOT EXISTS is_positive BOOLEAN,
    ADD COLUMN IF NOT EXISTS rating TEXT,
    ADD COLUMN IF NOT EXISTS from_username TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Backfill is_positive based on rating if NULL
UPDATE public.feedback
SET is_positive = (rating = 'positive')
WHERE is_positive IS NULL AND rating IS NOT NULL;

-- Set default and NOT NULL constraint safely
ALTER TABLE IF EXISTS public.feedback
    ALTER COLUMN is_positive SET DEFAULT TRUE;

-- 4. Enable Row Level Security (RLS)
ALTER TABLE IF EXISTS public.feedback ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
DROP POLICY IF EXISTS "Public feedback is viewable by everyone" ON public.feedback;
CREATE POLICY "Public feedback is viewable by everyone"
    ON public.feedback
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert feedback for their trades" ON public.feedback;
CREATE POLICY "Authenticated users can insert feedback for their trades"
    ON public.feedback
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = from_user);

DROP POLICY IF EXISTS "Users can update their own feedback" ON public.feedback;
CREATE POLICY "Users can update their own feedback"
    ON public.feedback
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = from_user)
    WITH CHECK (auth.uid() = from_user);

-- 6. Indexes for fast counterparty and trade feedback lookups
CREATE INDEX IF NOT EXISTS idx_feedback_trade_id ON public.feedback(trade_id);
CREATE INDEX IF NOT EXISTS idx_feedback_to_user ON public.feedback(to_user);
CREATE INDEX IF NOT EXISTS idx_feedback_from_user ON public.feedback(from_user);
CREATE INDEX IF NOT EXISTS idx_feedback_is_positive ON public.feedback(is_positive);
