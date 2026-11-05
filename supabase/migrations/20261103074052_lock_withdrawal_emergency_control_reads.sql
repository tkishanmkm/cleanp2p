BEGIN;

-- Serialize request-time reads of the emergency switches with administrative
-- updates. If a pause update wins first, a concurrent withdrawal reservation
-- sees the paused value; if the reservation locks first, the admin update waits
-- for that already-started transaction to finish.
DO $migration$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  v_definition := pg_catalog.pg_get_functiondef(
    'public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)'::regprocedure
  );

  IF pg_catalog.strpos(v_definition, 'WHERE key = ''prevent_withdrawals'';') = 0
     OR pg_catalog.strpos(v_definition, 'WHERE key = ''emergency_mode'';') = 0
     OR pg_catalog.strpos(v_definition, 'WHERE key = ''prevent_withdrawals'' FOR SHARE;') > 0
     OR pg_catalog.strpos(v_definition, 'WHERE key = ''emergency_mode'' FOR SHARE;') > 0 THEN
    RAISE EXCEPTION 'request_withdrawal emergency-control query no longer matches the expected definition';
  END IF;

  v_updated := pg_catalog.replace(
    v_definition,
    'WHERE key = ''prevent_withdrawals'';',
    'WHERE key = ''prevent_withdrawals''' || E'\n' || '  FOR SHARE;'
  );
  v_updated := pg_catalog.replace(
    v_updated,
    'WHERE key = ''emergency_mode'';',
    'WHERE key = ''emergency_mode''' || E'\n' || '  FOR SHARE;'
  );

  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'request_withdrawal emergency-control row locks were not added';
  END IF;

  EXECUTE v_updated;
END
$migration$;

COMMIT;