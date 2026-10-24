-- Restrict HD derivation index allocation to trusted server-side provisioning.
-- Draft until reviewed and applied through the approved database migration process.
-- This RPC increments a global index and must not be callable by browser roles.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_next_hd_index(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_hd_index(text, text)
  TO service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_next_hd_index(text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.get_next_hd_index(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Client EXECUTE privilege remains on public.get_next_hd_index(text,text)';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.get_next_hd_index(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must retain EXECUTE on public.get_next_hd_index(text,text)';
  END IF;
END;
$$;

COMMIT;
