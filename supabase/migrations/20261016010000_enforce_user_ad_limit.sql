-- Enforce the per-user advertisement cap atomically at the database boundary.
-- Deleted ads do not count; users can remove an old ad before creating another.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_user_ad_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  existing_ads integer;
BEGIN
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'Advertisement owner is required'
      USING ERRCODE = '23502';
  END IF;

  -- Serialize concurrent inserts for the same owner to prevent race-condition bypass.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(NEW.user_id::text, 0)
  );

  SELECT count(*)
    INTO existing_ads
    FROM public.ads AS a
   WHERE a.user_id = NEW.user_id
     AND COALESCE(a.is_deleted, false) = false;

  IF existing_ads >= 10 THEN
    RAISE EXCEPTION 'Advertisement limit reached: delete an existing advertisement before creating another'
      USING ERRCODE = '23514',
            CONSTRAINT = 'ads_user_limit_check';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_user_ad_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_user_ad_limit_before_insert ON public.ads;
CREATE TRIGGER enforce_user_ad_limit_before_insert
BEFORE INSERT ON public.ads
FOR EACH ROW
EXECUTE FUNCTION public.enforce_user_ad_limit();

COMMIT;
