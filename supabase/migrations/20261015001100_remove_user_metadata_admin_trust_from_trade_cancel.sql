-- Remove trust in user-editable raw_user_meta_data when authorizing trade cancellation.
-- Rebuild the existing function definition from pg_get_functiondef so the rest of
-- the deployed routine remains byte-for-byte unchanged.
DO $migration$
DECLARE
  v_def text;
  v_old text := '((raw_user_meta_data->>''role'') = ''admin'' OR (raw_app_meta_data->>''role'') = ''admin'')';
  v_new text := '((raw_app_meta_data->>''role'') = ''admin'')';
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'cancel_p2p_trade'
    AND pg_get_function_identity_arguments(p.oid) = 'p_trade_id uuid, p_caller_id uuid, p_reason text';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Expected public.cancel_p2p_trade(uuid, uuid, text) was not found';
  END IF;

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'Expected legacy user-metadata admin check was not found; refusing an unsafe rewrite';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END
$migration$;
