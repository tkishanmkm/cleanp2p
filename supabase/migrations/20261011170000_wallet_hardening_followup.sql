-- Remove a hardcoded bearer credential from a legacy worker trigger function.
-- The worker will not be called until a dedicated secret is provisioned in Supabase Vault.
CREATE OR REPLACE FUNCTION public.trigger_withdrawal_worker()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'withdrawal_worker_bearer'
   LIMIT 1;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE WARNING 'Withdrawal worker dispatch skipped: Vault secret withdrawal_worker_bearer is not configured.';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://paxones.com/api/workers/withdrawal-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_withdrawal_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_withdrawal_worker() TO service_role;
