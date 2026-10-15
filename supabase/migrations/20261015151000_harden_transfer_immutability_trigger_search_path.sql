-- This SECURITY DEFINER trigger function only compares NEW/OLD row fields;
-- it needs no schema lookup, so use an empty search_path.
ALTER FUNCTION public.prevent_transfer_immutability_update() SET search_path = '';
