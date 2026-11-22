BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_user_status_secure(
  p_admin_id uuid,
  p_target_user_id uuid,
  p_status public.user_status_enum,
  p_ban_reason text DEFAULT NULL,
  p_ban_policy public.ban_withdrawal_policy_enum DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_admin_email text;
  v_reason text := pg_catalog.btrim(coalesce(p_ban_reason, ''));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_admin_id IS NULL
     OR p_target_user_id IS NULL
     OR p_status IS NULL THEN
    RAISE EXCEPTION 'Administrator, target user and status are required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_active_admin_identity(p_admin_id) THEN
    RAISE EXCEPTION 'A provisioned active administrator is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_admin_id = p_target_user_id THEN
    RAISE EXCEPTION 'Administrators cannot change their own account status'
      USING ERRCODE = '42501';
  END IF;

  IF p_status = 'banned'::public.user_status_enum THEN
    IF pg_catalog.length(v_reason) < 3 OR pg_catalog.length(v_reason) > 500 THEN
      RAISE EXCEPTION 'A ban reason between 3 and 500 characters is required'
        USING ERRCODE = '22023';
    END IF;
    IF p_ban_policy IS NULL THEN
      RAISE EXCEPTION 'A withdrawal policy is required for a ban'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM 1
  FROM public.profiles p
  WHERE p.id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT NULLIF(pg_catalog.btrim(u.email), '')
    INTO v_admin_email
  FROM auth.users u
  WHERE u.id = p_admin_id;

  UPDATE public.profiles
  SET status = p_status,
      is_banned = (p_status = 'banned'::public.user_status_enum),
      is_suspended = (p_status = 'suspended'::public.user_status_enum),
      ban_reason = CASE WHEN p_status = 'banned'::public.user_status_enum THEN v_reason ELSE NULL END,
      ban_policy = CASE WHEN p_status = 'banned'::public.user_status_enum THEN p_ban_policy ELSE NULL END,
      banned_at = CASE
        WHEN p_status = 'banned'::public.user_status_enum
          THEN coalesce(banned_at, pg_catalog.clock_timestamp())
        ELSE NULL
      END,
      status_operation_id = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_target_user_id;

  IF p_status IN (
    'suspended'::public.user_status_enum,
    'banned'::public.user_status_enum,
    'deleted'::public.user_status_enum
  ) THEN
    UPDATE public.advertisements
    SET is_active = false
    WHERE user_id = p_target_user_id;
  END IF;

  INSERT INTO public.admin_audit_logs (
    admin_id, admin_email, action, target_user_id, details, created_at
  )
  VALUES (
    p_admin_id,
    v_admin_email,
    'UPDATE_USER_STATUS',
    p_target_user_id,
    pg_catalog.jsonb_build_object(
      'new_status', p_status,
      'ban_reason', CASE WHEN p_status = 'banned'::public.user_status_enum THEN v_reason ELSE NULL END,
      'ban_policy', CASE WHEN p_status = 'banned'::public.user_status_enum THEN p_ban_policy ELSE NULL END
    ),
    pg_catalog.clock_timestamp()
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'target_user_id', p_target_user_id,
    'status', p_status
  );
END;
$function$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.admin_update_user_status_secure(uuid,uuid,public.user_status_enum,text,public.ban_withdrawal_policy_enum)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
  ON FUNCTION public.admin_update_user_status_secure(uuid,uuid,public.user_status_enum,text,public.ban_withdrawal_policy_enum)
  TO service_role;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.admin_update_user_status(text,uuid,public.user_status_enum,text,public.ban_withdrawal_policy_enum)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
