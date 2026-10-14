-- Enforce positive deposit amounts at the database boundary.
-- Safe to apply after verifying no existing rows violate the constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.deposits'::regclass
      AND conname = 'deposits_amount_positive_check'
  ) THEN
    ALTER TABLE public.deposits
      ADD CONSTRAINT deposits_amount_positive_check CHECK (amount > 0);
  END IF;
END
$$;
