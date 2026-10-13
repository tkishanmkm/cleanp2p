-- Step 35Z: contain the remaining legacy deposit-credit entry point.
-- The function credits a stored onchain_deposits row without independently
-- validating canonical chain evidence in the database. Automatic deposit credit
-- remains disabled until a verified replacement is designed and audited.
REVOKE EXECUTE ON FUNCTION public.process_confirmed_deposit(uuid) FROM service_role;
