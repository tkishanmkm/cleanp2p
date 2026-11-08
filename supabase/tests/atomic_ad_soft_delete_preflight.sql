-- Read-only verification for atomic advertisement soft deletion.
DO $ad_soft_delete_preflight$
DECLARE
  v_oid oid := to_regprocedure('public.set_ad_status_atomic_authorized(uuid,text,uuid,text,text)');
  v_definition text;
  v_expected_status text := $$IF v_status NOT IN ('ACTIVE', 'INACTIVE', 'PAUSED', 'HIDDEN', 'DRAFT', 'DELETED') THEN$$;
  v_deleted_assignment text := $$is_deleted = (v_status = 'DELETED'),$$;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Atomic advertisement status RPC is missing.';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;

  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = v_oid)) <> 'postgres'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid)
     OR NOT COALESCE((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = v_oid), FALSE) THEN
    RAISE EXCEPTION 'Atomic advertisement status RPC must remain postgres-owned SECURITY DEFINER with empty search_path.';
  END IF;

  IF position(v_expected_status IN v_definition) = 0
     OR (length(v_definition) - length(replace(v_definition, v_deleted_assignment, '')))
        / length(v_deleted_assignment) <> 2
     OR position('DELETED ADVERTISEMENTS CANNOT BE REACTIVATED OR CHANGED' IN upper(v_definition)) = 0
     OR position('auth.jwt()' IN v_definition) = 0
     OR position('is_active_full_admin_actor' IN v_definition) = 0
     OR position('FOR UPDATE' IN upper(v_definition)) = 0
     OR position('ADMIN_AD_STATUS_CHANGE' IN v_definition) = 0
     OR position('UPDATE PUBLIC.P2P_ADS' IN upper(v_definition)) = 0
     OR position('UPDATE PUBLIC.ADS' IN upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'Soft-delete support is missing or the atomic owner/admin, terminal-state, lock, mirror or audit contract changed.';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
         FROM pg_proc AS p
         CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
        WHERE p.oid = v_oid
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Atomic advertisement status RPC execution must remain service_role-only.';
  END IF;
END;
$ad_soft_delete_preflight$;
