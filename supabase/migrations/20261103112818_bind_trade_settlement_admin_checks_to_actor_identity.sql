BEGIN;

CREATE OR REPLACE FUNCTION public.is_active_admin_identity(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
      WHERE u.id = p_user_id
        AND coalesce(p.is_banned, false) = false
        AND coalesce(p.is_suspended, false) = false
        AND coalesce(p.is_on_hold, false) = false
        AND lower(coalesce(p.status::text, '')) NOT IN ('banned', 'suspended', 'disabled')
        AND (
          lower(coalesce(p.role::text, '')) = 'admin'
          OR coalesce(p.is_admin, false) = true
          OR coalesce(p.is_admin_account, false) = true
          OR lower(coalesce(u.raw_app_meta_data->>'role', '')) = 'admin'
          OR lower(coalesce(u.raw_app_meta_data->>'is_admin', 'false')) IN ('true', '1')
          OR EXISTS (
            SELECT 1
            FROM public.app_admins a
            WHERE a.user_id = p_user_id
          )
        )
    )
  END;
$function$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.is_active_admin_identity(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new constant text := 'v_is_admin := public.is_active_admin_identity(v_effective_caller);';
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    'public.cancel_p2p_trade(uuid,uuid,text)'::regprocedure
  );
  v_old := E'v_is_admin := public.is_admin()\r\n               OR (v_effective_caller IS NOT NULL AND EXISTS (\r\n                   SELECT 1 FROM auth.users\r\n                   WHERE id = v_effective_caller\r\n                     AND ((raw_app_meta_data->>''role'') = ''admin'')\r\n               ));';
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Expected cancel_p2p_trade admin-check block was not found';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.mark_p2p_trade_paid(uuid,uuid,text)'::regprocedure
  );
  v_old := E'v_is_admin :=\r\n        public.is_admin()\r\n        OR EXISTS (\r\n            SELECT 1\r\n            FROM public.app_admins\r\n            WHERE user_id::TEXT = v_effective_caller::TEXT\r\n        )\r\n        OR EXISTS (\r\n            SELECT 1\r\n            FROM auth.users\r\n            WHERE id::TEXT = v_effective_caller::TEXT\r\n              AND (\r\n                    raw_app_meta_data->>''role'' = ''admin''\r\n                 OR COALESCE(\r\n                        (raw_app_meta_data->>''is_admin'')::BOOLEAN,\r\n                        FALSE\r\n                    ) = TRUE\r\n              )\r\n        );';
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Expected mark_p2p_trade_paid admin-check block was not found';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.release_trade_escrow(uuid,uuid)'::regprocedure
  );
  v_old := E'v_is_admin := public.is_admin()\r\n               OR EXISTS (\r\n                   SELECT 1 FROM auth.users\r\n                   WHERE id = v_effective_caller\r\n                     AND ((raw_app_meta_data->>''role'') = ''admin'')\r\n               );';
  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Expected release_trade_escrow admin-check block was not found';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END;
$migration$;

ALTER FUNCTION public.release_trade_escrow(uuid,uuid)
  SET search_path = '';

COMMIT;
