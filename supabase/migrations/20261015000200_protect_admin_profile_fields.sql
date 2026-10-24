-- Prevent self-service profile updates from changing authorization or admin 2FA fields.
-- Existing profile RLS permits users to update their own row; this trigger protects
-- privileged columns even when the UPDATE policy is otherwise permissive.
BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_field_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  -- Trusted service-role writes are used by server-side admin management flows.
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
     OR NEW.is_admin_account IS DISTINCT FROM OLD.is_admin_account
     OR NEW.admin_2fa_enabled IS DISTINCT FROM OLD.admin_2fa_enabled
     OR NEW.is_2fa_enabled IS DISTINCT FROM OLD.is_2fa_enabled
     OR NEW.admin_2fa_recovery_updated_at IS DISTINCT FROM OLD.admin_2fa_recovery_updated_at
  THEN
    RAISE EXCEPTION 'Privileged profile fields cannot be changed through self-service updates'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_profile_privilege_field_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_profile_privilege_fields ON public.profiles;
CREATE TRIGGER protect_profile_privilege_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_privilege_field_changes();

COMMIT;
