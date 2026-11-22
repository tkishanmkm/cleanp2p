BEGIN;

-- supabase_auth_admin must not inherit application table privileges from the
-- postgres role. Auth's public-schema hooks and auth.users triggers are
-- SECURITY DEFINER functions owned by postgres, so they do not require direct
-- DML rights on application tables.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM supabase_auth_admin;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM supabase_auth_admin;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM supabase_auth_admin;

-- Stop future postgres-owned public objects from automatically granting
-- broad access to the internal Auth service role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM supabase_auth_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM supabase_auth_admin;

-- Supabase Auth's configured custom access-token hook is the sole public
-- function intentionally callable by supabase_auth_admin.
ALTER FUNCTION public.custom_access_token_hook(jsonb)
  SET search_path = '';
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  TO supabase_auth_admin;

COMMIT;