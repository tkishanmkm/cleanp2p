-- Add the account state already exposed by the admin API.
-- Keep this as its own migration so later function migrations can safely use
-- the new enum label after this migration has committed.
ALTER TYPE public.user_status_enum ADD VALUE IF NOT EXISTS 'restricted';
