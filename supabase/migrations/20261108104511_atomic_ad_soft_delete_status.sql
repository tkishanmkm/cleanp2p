-- Extend the existing atomic ad status RPC with terminal soft deletion.
-- Preserve its original owner/admin checks, paired-row locks, mirror updates and audit.
BEGIN;

DO $ad_soft_delete_migration$
DECLARE
  v_oid oid := to_regprocedure('public.set_ad_status_atomic_authorized(uuid,text,uuid,text,text)');
  v_definition text;
  v_old_status text := $$IF v_status NOT IN ('ACTIVE', 'INACTIVE', 'PAUSED', 'HIDDEN', 'DRAFT') THEN$$;
  v_new_status text := $$IF v_status NOT IN ('ACTIVE', 'INACTIVE', 'PAUSED', 'HIDDEN', 'DRAFT', 'DELETED') THEN$$;
  v_active_assignment text := $$is_active = (v_status = 'ACTIVE'),$$;
  v_deleted_assignment text := $$is_deleted = (v_status = 'DELETED'),$$;
  v_update_marker text := $$IF p_p2p_ad_id IS NOT NULL THEN
        UPDATE public.p2p_ads$$;
  v_update_guard text := $$IF v_status <> 'DELETED'
       AND (
         pg_catalog.upper(pg_catalog.btrim(coalesce(v_p2p_previous_status, ''))) = 'DELETED'
         OR pg_catalog.upper(pg_catalog.btrim(coalesce(v_legacy_previous_status, ''))) = 'DELETED'
       ) THEN
        RAISE EXCEPTION 'Deleted advertisements cannot be reactivated or changed.'
            USING ERRCODE = '23514';
    END IF;

    IF p_p2p_ad_id IS NOT NULL THEN
        UPDATE public.p2p_ads$$;
  v_status_occurrences integer;
  v_active_occurrences integer;
  v_deleted_occurrences integer;
  v_update_marker_occurrences integer;
  v_owner text;
  v_is_definer boolean;
  v_config text[];
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Atomic ad status RPC is missing; apply its base migration first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='p2p_ads'
       AND column_name='is_deleted' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='ads'
       AND column_name='is_deleted' AND data_type='boolean'
  ) THEN
    RAISE EXCEPTION 'Both ad tables must expose the boolean is_deleted column before atomic soft deletion.';
  END IF;

  SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
    INTO v_owner, v_is_definer, v_config, v_definition
    FROM pg_proc AS p
   WHERE p.oid = v_oid;

  IF v_owner <> 'postgres'
     OR v_is_definer IS DISTINCT FROM TRUE
     OR NOT COALESCE(v_config @> ARRAY['search_path=""'], FALSE) THEN
    RAISE EXCEPTION 'Atomic ad status RPC ownership or security configuration is not the expected contract.';
  END IF;

  v_status_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_old_status, '')))
    / length(v_old_status);
  IF v_status_occurrences <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one atomic ad status allowlist marker; found %.', v_status_occurrences;
  END IF;

  v_active_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_active_assignment, '')))
    / length(v_active_assignment);
  IF v_active_occurrences <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two canonical/legacy is_active assignments; found %.', v_active_occurrences;
  END IF;

  v_deleted_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_deleted_assignment, '')))
    / length(v_deleted_assignment);
  IF v_deleted_occurrences <> 0 THEN
    RAISE EXCEPTION 'The atomic ad status RPC already has is_deleted assignments; refusing an ambiguous rewrite.';
  END IF;

  v_update_marker_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_update_marker, '')))
    / length(v_update_marker);
  IF v_update_marker_occurrences <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one canonical ad update insertion point; found %.', v_update_marker_occurrences;
  END IF;

  v_definition := replace(v_definition, v_old_status, v_new_status);
  v_definition := replace(
    v_definition,
    v_active_assignment,
    v_active_assignment || E'\n               is_deleted = (v_status = ''DELETED''),'
  );
  v_definition := replace(v_definition, v_update_marker, v_update_guard);

  EXECUTE v_definition;

  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
    FROM pg_proc AS p
   WHERE p.oid = v_oid;

  IF position(v_new_status IN v_definition) = 0
     OR (length(v_definition) - length(replace(v_definition, v_deleted_assignment, '')))
        / length(v_deleted_assignment) <> 2
     OR position('V_P2P_PREVIOUS_STATUS' IN upper(v_definition)) = 0
     OR position('V_LEGACY_PREVIOUS_STATUS' IN upper(v_definition)) = 0
     OR position('UPDATE PUBLIC.P2P_ADS' IN upper(v_definition)) = 0
     OR position('UPDATE PUBLIC.ADS' IN upper(v_definition)) = 0
     OR position('FOR UPDATE' IN upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'Atomic ad status RPC did not retain DELETED, terminal deletion, paired-row updates and row locking.';
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
    RAISE EXCEPTION 'Atomic ad status RPC execution grants changed unexpectedly.';
  END IF;
END;
$ad_soft_delete_migration$;

NOTIFY pgrst, 'reload schema';
COMMIT;
