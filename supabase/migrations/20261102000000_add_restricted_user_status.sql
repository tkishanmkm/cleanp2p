-- Add the distinct restricted account state before migrations that use it.
-- This must remain a separate migration so the new enum value is committed
-- before any following migration parses or casts it.
ALTER TYPE public.user_status_enum ADD VALUE IF NOT EXISTS 'restricted';
