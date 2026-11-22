-- Defense in depth: block creation of trades involving disabled accounts.
-- Prepared locally only. Do not apply to a live database before isolated PostgreSQL tests.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_trade_participant_account_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_participant_id text;
  v_profile_status text;
  v_account_status text;
  v_is_banned boolean;
  v_is_restricted boolean;
  v_is_suspended boolean;
  v_is_minor_restricted boolean;
BEGIN
  IF NEW.buyer_id IS NULL OR NEW.seller_id IS NULL
     OR NULLIF(btrim(NEW.buyer_id::text), '') IS NULL
     OR NULLIF(btrim(NEW.seller_id::text), '') IS NULL THEN
    RAISE EXCEPTION 'Trade participants must be specified and verified.'
      USING ERRCODE = '23502', DETAIL = 'TRADE_PARTICIPANT_REQUIRED';
  END IF;

  IF btrim(NEW.buyer_id::text) = btrim(NEW.seller_id::text) THEN
    RAISE EXCEPTION 'A user cannot trade with their own account.'
      USING ERRCODE = '23514', DETAIL = 'SELF_TRADE_PROHIBITED';
  END IF;

  FOREACH v_participant_id IN ARRAY ARRAY[
    btrim(NEW.buyer_id::text),
    btrim(NEW.seller_id::text)
  ]
  LOOP
    SELECT p.status::text,
           p.account_status,
           COALESCE(p.is_banned, false),
           COALESCE(p.is_restricted, false),
           COALESCE(p.is_suspended, false),
           COALESCE(p.is_minor_restricted, false)
      INTO v_profile_status,
           v_account_status,
           v_is_banned,
           v_is_restricted,
           v_is_suspended,
           v_is_minor_restricted
    FROM public.profiles p
    WHERE p.id::text = v_participant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Trade participant account could not be verified.'
        USING ERRCODE = '42501', DETAIL = 'TRADE_PARTICIPANT_UNVERIFIED';
    END IF;

    IF COALESCE(v_is_banned, false)
       OR COALESCE(v_is_restricted, false)
       OR COALESCE(v_is_suspended, false)
       OR COALESCE(v_is_minor_restricted, false)
       OR LOWER(COALESCE(v_profile_status, '')) IN ('banned', 'restricted', 'suspended', 'deleted')
       OR v_account_status IS NULL
       OR LOWER(btrim(v_account_status)) <> 'active'
       OR UPPER(COALESCE(v_account_status, '')) IN
          ('BANNED', 'RESTRICTED', 'SUSPENDED', 'DELETION_PENDING', 'DELETED') THEN
      RAISE EXCEPTION 'Trade creation is disabled for one or more participants.'
        USING ERRCODE = '42501', DETAIL = 'TRADE_PARTICIPANT_ACCOUNT_DISABLED';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_trade_participant_account_status()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_guard_trade_participant_account_status ON public.trades;
CREATE TRIGGER a_guard_trade_participant_account_status
BEFORE INSERT ON public.trades
FOR EACH ROW
EXECUTE FUNCTION public.guard_trade_participant_account_status();

COMMIT;
