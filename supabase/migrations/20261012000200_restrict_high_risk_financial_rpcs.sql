-- Restrict high-risk financial RPCs to trusted server-side execution.
--
-- REVIEW GATE: this migration is intentionally proposed as a draft. Before applying,
-- verify all app/worker call sites and exercise the replacement server-side flows in
-- staging. These functions currently lack sufficient internal authorization/state
-- validation; this ACL change is defense-in-depth, not a substitute for fixing logic.
--
-- Do not grant these RPCs back to anon/authenticated to work around client failures.
-- Replace client calls with validated server-side handlers using the service role.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.admin_release_escrow(character varying, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_release_escrow(character varying, uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_trade_atomic(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_trade_atomic(uuid)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_p2p_release(uuid, uuid, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_p2p_release(uuid, uuid, numeric, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.lock_p2p_escrow(uuid, uuid, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_p2p_escrow(uuid, uuid, numeric)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.initiate_p2p_trade(uuid, uuid, uuid, numeric, text, numeric, numeric, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_p2p_trade(uuid, uuid, uuid, numeric, text, numeric, numeric, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_next_hd_index(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_hd_index(text, text)
  TO service_role;

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.admin_release_escrow(character varying,uuid,text)'::regprocedure,
    'public.complete_trade_atomic(uuid)'::regprocedure,
    'public.finalize_p2p_release(uuid,uuid,numeric,text)'::regprocedure,
    'public.lock_p2p_escrow(uuid,uuid,numeric)'::regprocedure,
    'public.initiate_p2p_trade(uuid,uuid,uuid,numeric,text,numeric,numeric,text,text)'::regprocedure,
    'public.get_next_hd_index(text,text)'::regprocedure
  ]
  LOOP
    IF has_function_privilege('anon', fn, 'EXECUTE')
       OR has_function_privilege('authenticated', fn, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'Unexpected client EXECUTE privilege remains on %', fn;
    END IF;

    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role lost EXECUTE privilege on %', fn;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
