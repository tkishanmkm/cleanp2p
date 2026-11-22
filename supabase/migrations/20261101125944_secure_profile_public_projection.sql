-- Make public profile access explicit and separate it from private account data.
-- The base profiles table is owner-only for authenticated clients. Public trader
-- cards use a narrow security-barrier view containing only approved fields.
BEGIN;

-- Remove the broad row policy and rebuild owner-only access on the base table.
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT
TO authenticated
USING (
    auth.uid() IS NOT NULL
    AND auth.uid() = id
);

-- Revoke legacy column-level SELECT grants before granting authenticated users
-- a table-level SELECT privilege constrained by the owner-only RLS policy.
DO $revoke_profile_column_reads$
DECLARE
    v_grant RECORD;
BEGIN
    FOR v_grant IN
        SELECT DISTINCT grantee, column_name
        FROM information_schema.column_privileges
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND privilege_type = 'SELECT'
          AND grantee IN ('anon', 'authenticated')
    LOOP
        EXECUTE format(
            'REVOKE SELECT (%I) ON TABLE public.profiles FROM %I',
            v_grant.column_name,
            v_grant.grantee
        );
    END LOOP;
END;
$revoke_profile_column_reads$;

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.profiles TO authenticated;

-- Keep the existing self-update column allowlist, but make both row predicates
-- explicit. A client cannot move its profile row to another auth user.
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
    auth.uid() IS NOT NULL
    AND auth.uid() = id
)
WITH CHECK (
    auth.uid() IS NOT NULL
    AND auth.uid() = id
);

-- The public projection deliberately excludes email, phone/contact fields,
-- postal/street address, DOB, account status, admin flags, wallet/deposit
-- addresses, identity documents, KYC session/document identifiers, security
-- answers, and every 2FA/TOTP secret or recovery hash.
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_barrier = true)
AS
SELECT
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.photo_url,
    p.country,
    p.country_code,
    p.created_at,
    p.is_online,
    p.is_verified,
    p.completed_trades,
    p.total_completed_trades,
    p.trade_volume,
    p.total_volume_usd,
    p.positive_feedback,
    p.negative_feedback,
    p.feedback_score,
    p.avg_payment_time_mins,
    p.avg_payment_minutes,
    p.avg_pay_time,
    p.avg_release_time_mins,
    p.avg_release_minutes,
    p.avg_release_time,
    p.merchant_tier,
    (
        LOWER(COALESCE(p.status::TEXT, '')) = 'active'
        AND LOWER(COALESCE(p.account_status, 'active')) = 'active'
        AND NOT COALESCE(p.is_banned, FALSE)
        AND NOT COALESCE(p.is_suspended, FALSE)
        AND NOT COALESCE(p.is_restricted, FALSE)
        AND NOT COALESCE(p.is_on_hold, FALSE)
        AND NOT COALESCE(p.is_emergency_frozen, FALSE)
        AND NOT COALESCE(p.is_minor_restricted, FALSE)
    ) AS is_trading_eligible
FROM public.profiles AS p;

ALTER VIEW public.public_profiles OWNER TO postgres;
REVOKE ALL ON TABLE public.public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_profiles TO anon, authenticated;

-- Presence writes are mediated through the authenticated identity, never a
-- caller-supplied user_id. This keeps is_online/last_seen_at out of the broad
-- client UPDATE column allowlist.
CREATE OR REPLACE FUNCTION public.set_my_presence(p_is_online BOOLEAN DEFAULT TRUE)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF COALESCE(auth.role(), '') <> 'authenticated' OR v_user_id IS NULL THEN
        RAISE EXCEPTION 'An authenticated user session is required.' USING ERRCODE = '42501';
    END IF;
    IF p_is_online IS NULL THEN
        RAISE EXCEPTION 'Presence state is required.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.profiles
       SET is_online = p_is_online,
           last_seen_at = NOW()
     WHERE id = v_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Authenticated user profile was not found.' USING ERRCODE = 'P0002';
    END IF;

    RETURN TRUE;
END;
$function$;

ALTER FUNCTION public.set_my_presence(BOOLEAN) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_my_presence(BOOLEAN)
    FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.set_my_presence(BOOLEAN) TO authenticated;

COMMIT;
