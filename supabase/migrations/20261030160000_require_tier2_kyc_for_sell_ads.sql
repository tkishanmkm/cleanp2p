-- A seller must be Tier 2 verified even when inserting ads directly through PostgREST.
-- Keep this function argument-free so it cannot be used to query other users' KYC state.
CREATE OR REPLACE FUNCTION public.current_user_tier2_verified()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = auth.uid()
      AND (
        COALESCE(p.is_verified, false) = true
        OR COALESCE(p.id_verified, false) = true
        OR LOWER(COALESCE(p.kyc_status, '')) IN ('approved', 'verified', 'passed')
        OR LOWER(COALESCE(p.verification_tier, '')) IN ('2', 'tier_2', 'tier2')
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.current_user_tier2_verified() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_tier2_verified() TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated users can create own ads" ON public.ads;
CREATE POLICY "Authenticated users can create own ads"
ON public.ads
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND (
    UPPER(COALESCE(type, trade_type, 'BUY')) NOT IN ('SELL', 'ONLINE_SELL')
    OR public.current_user_tier2_verified()
  )
);

DROP POLICY IF EXISTS "Users can create ads" ON public.p2p_ads;
CREATE POLICY "Users can create ads"
ON public.p2p_ads
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND (
    UPPER(COALESCE(ad_type, type, 'BUY')) NOT IN ('SELL', 'ONLINE_SELL')
    OR public.current_user_tier2_verified()
  )
);
