-- ==============================================================================
-- 20260925000014_fix_profile_and_wallet_index_provisioning.sql
-- 
-- SUMMARY:
-- 1. Synchronizes public.user_wallet_index_seq safely (never steps backward).
-- 2. Enforces partial unique index on public.profiles(wallet_index) WHERE wallet_index IS NOT NULL.
-- 3. Replaces public.handle_new_user() with a fail-closed, sequence-based trigger.
-- 4. Removes speculative wallet_assets initialization (wallet_assets are created on-demand).
-- 5. Idempotently repairs orphaned user 37cbd587-9da1-48a1-9659-ed9f49c3e40c from auth metadata.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- PART 1: SYNCHRONIZE WALLET INDEX SEQUENCE
-- ------------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.user_wallet_index_seq;

-- Safely synchronize sequence to max(profiles.wallet_index, current last_value)
-- With existing max wallet_index = 321, last_value is set to 321 (is_called = true),
-- so the very next nextval() call will monotonically return 322.
DO $$
DECLARE
    v_max_profile_idx INTEGER;
    v_seq_last_val BIGINT;
    v_target_val BIGINT;
BEGIN
    SELECT COALESCE(MAX(wallet_index), 0) INTO v_max_profile_idx FROM public.profiles;
    SELECT last_value INTO v_seq_last_val FROM public.user_wallet_index_seq;
    
    v_target_val := GREATEST(v_max_profile_idx, COALESCE(v_seq_last_val, 1));

    PERFORM setval('public.user_wallet_index_seq', v_target_val, true);
END $$;

-- ------------------------------------------------------------------------------
-- PART 2: PARTIAL UNIQUE INDEX ON WALLET_INDEX
-- ------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_wallet_index_unique
ON public.profiles(wallet_index)
WHERE wallet_index IS NOT NULL;

-- ------------------------------------------------------------------------------
-- PART 3: REPLACE handle_new_user() TRIGGER FUNCTION (FAIL-CLOSED)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_wallet_index INTEGER;
    v_username TEXT;
    v_raw_username TEXT;
    v_full_name TEXT;
    v_avatar_url TEXT;
    v_raw_dob TEXT;
    v_sec_q TEXT;
    v_sec_a TEXT;
    v_has_onboarding BOOLEAN := FALSE;
    v_country TEXT;
BEGIN
    -- 1. Atomically allocate new monotonic wallet index from sequence
    v_wallet_index := nextval('public.user_wallet_index_seq');

    -- 2. Extract full name / display name from metadata
    v_full_name := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'displayName'), ''),
        ''
    );

    -- 3. Extract avatar URL from metadata
    v_avatar_url := COALESCE(
        NEW.raw_user_meta_data->>'avatar_url',
        NEW.raw_user_meta_data->>'picture',
        NEW.raw_user_meta_data->>'photo_url'
    );

    -- 4. Extract raw DOB text without casting to date
    v_raw_dob := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'dob'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'date_of_birth'), '')
    );

    -- 5. Extract security questions
    v_sec_q := COALESCE(NEW.raw_user_meta_data->>'security_question', NEW.raw_user_meta_data->>'securityQuestion');
    v_sec_a := COALESCE(NEW.raw_user_meta_data->>'security_answer', NEW.raw_user_meta_data->>'securityAnswer');

    IF v_full_name != '' AND v_raw_dob IS NOT NULL AND v_sec_q IS NOT NULL AND v_sec_a IS NOT NULL THEN
        v_has_onboarding := TRUE;
    END IF;

    v_country := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'country'), ''), 'IN');

    -- 6. Extract or generate unique username safely
    v_raw_username := NULLIF(TRIM(NEW.raw_user_meta_data->>'username'), '');
    IF v_raw_username IS NOT NULL AND length(v_raw_username) >= 3 THEN
        v_username := lower(regexp_replace(v_raw_username, '[^a-z0-9._]', '', 'g'));
        IF length(v_username) < 3 OR EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username) THEN
            v_username := public.generate_system_username();
        END IF;
    ELSE
        v_username := public.generate_system_username();
    END IF;

    -- 7. Insert profile deterministically (FAIL-CLOSED: any error aborts auth transaction)
    INSERT INTO public.profiles (
        id,
        wallet_index,
        username,
        display_name,
        full_name,
        name,
        email,
        dob,
        date_of_birth,
        security_question,
        security_answer,
        onboarding_completed,
        avatar_url,
        photo_url,
        country,
        preferred_currency,
        username_changed,
        username_changes_remaining,
        username_changed_count,
        status,
        account_status,
        is_suspended,
        is_banned,
        is_online,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        v_wallet_index,
        v_username,
        v_username,
        v_full_name,
        v_full_name,
        NEW.email,
        v_raw_dob,
        v_raw_dob,
        v_sec_q,
        v_sec_a,
        v_has_onboarding,
        v_avatar_url,
        v_avatar_url,
        v_country,
        'USD',
        FALSE,
        1,
        0,
        'active',
        'ACTIVE',
        FALSE,
        FALSE,
        FALSE,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = COALESCE(EXCLUDED.email, public.profiles.email),
        full_name = CASE WHEN EXCLUDED.full_name != '' THEN EXCLUDED.full_name ELSE public.profiles.full_name END,
        name = CASE WHEN EXCLUDED.name != '' THEN EXCLUDED.name ELSE public.profiles.name END,
        dob = COALESCE(EXCLUDED.dob, public.profiles.dob),
        date_of_birth = COALESCE(EXCLUDED.date_of_birth, public.profiles.date_of_birth),
        avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url),
        photo_url = COALESCE(public.profiles.photo_url, EXCLUDED.photo_url),
        updated_at = NOW();

    RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- PART 4: RE-ATTACH TRIGGER TO auth.users
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- PART 5: IDEMPOTENT REPAIR OF ORPHANED USER 37cbd587-9da1-48a1-9659-ed9f49c3e40c
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_orphan_id UUID := '37cbd587-9da1-48a1-9659-ed9f49c3e40c'::UUID;
    v_orphan_auth RECORD;
    v_orphan_wallet_index INTEGER;
    v_raw_username TEXT;
    v_orphan_username TEXT;
    v_orphan_full_name TEXT;
    v_orphan_dob TEXT;
BEGIN
    SELECT * INTO v_orphan_auth FROM auth.users WHERE id = v_orphan_id;
    
    IF FOUND AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_orphan_id) THEN
        -- Allocate next monotonic wallet index
        v_orphan_wallet_index := nextval('public.user_wallet_index_seq');

        -- Resolve username from metadata or generator
        v_raw_username := NULLIF(TRIM(v_orphan_auth.raw_user_meta_data->>'username'), '');
        IF v_raw_username IS NOT NULL AND length(v_raw_username) >= 3 THEN
            v_orphan_username := lower(regexp_replace(v_raw_username, '[^a-z0-9._]', '', 'g'));
            IF length(v_orphan_username) < 3 OR EXISTS (SELECT 1 FROM public.profiles WHERE username = v_orphan_username) THEN
                v_orphan_username := public.generate_system_username();
            END IF;
        ELSE
            v_orphan_username := public.generate_system_username();
        END IF;

        -- Extract metadata fields
        v_orphan_full_name := COALESCE(
            NULLIF(TRIM(v_orphan_auth.raw_user_meta_data->>'full_name'), ''),
            NULLIF(TRIM(v_orphan_auth.raw_user_meta_data->>'name'), ''),
            'User'
        );

        v_orphan_dob := COALESCE(
            NULLIF(TRIM(v_orphan_auth.raw_user_meta_data->>'dob'), ''),
            NULLIF(TRIM(v_orphan_auth.raw_user_meta_data->>'date_of_birth'), '')
        );

        -- Insert missing profile
        INSERT INTO public.profiles (
            id,
            wallet_index,
            username,
            display_name,
            full_name,
            name,
            email,
            dob,
            date_of_birth,
            onboarding_completed,
            country,
            preferred_currency,
            username_changed,
            username_changes_remaining,
            username_changed_count,
            status,
            account_status,
            is_suspended,
            is_banned,
            is_online,
            created_at,
            updated_at
        )
        VALUES (
            v_orphan_id,
            v_orphan_wallet_index,
            v_orphan_username,
            v_orphan_username,
            v_orphan_full_name,
            v_orphan_full_name,
            v_orphan_auth.email,
            v_orphan_dob,
            v_orphan_dob,
            FALSE,
            'IN',
            'USD',
            FALSE,
            1,
            0,
            'active',
            'ACTIVE',
            FALSE,
            FALSE,
            FALSE,
            v_orphan_auth.created_at,
            NOW()
        );

        RAISE NOTICE 'Repaired orphan profile for % with wallet_index %', v_orphan_id, v_orphan_wallet_index;
    END IF;
END $$;

COMMIT;
