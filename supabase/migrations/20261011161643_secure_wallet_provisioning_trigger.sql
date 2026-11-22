-- The profile insert trigger must authenticate its internal provisioning request.
-- Provisioning is skipped until the dedicated Vault secret is configured.
CREATE OR REPLACE FUNCTION public.trigger_provision_user_wallets()
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
   WHERE name = 'wallet_provisioning_bearer'
   LIMIT 1;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE WARNING 'Wallet provisioning dispatch skipped: Vault secret wallet_provisioning_bearer is not configured.';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://paxones.com/api/auth/provision-wallets',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('userId', NEW.id)
  );

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_provision_user_wallets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_provision_user_wallets() TO service_role;
