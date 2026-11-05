BEGIN;

-- Supabase Data API access is now opt-in for all future public objects.
-- Existing object grants are unchanged; each future table, sequence or RPC
-- must receive explicit grants in the migration that creates it.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES
  FROM anon, authenticated, service_role, supabase_auth_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES
  FROM anon, authenticated, service_role, supabase_auth_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

COMMIT;