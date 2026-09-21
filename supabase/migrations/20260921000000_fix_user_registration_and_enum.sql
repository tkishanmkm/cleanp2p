-- ==============================================================================
-- 20260921000000_fix_user_registration_and_enum.sql
-- Fixes:
-- 1. Adds missing 'deleted', 'suspended', 'banned' values to user_status_enum
-- 2. Hardens public.handle_new_user() trigger so user sign-up never fails
-- ==============================================================================

-- 1. Ensure user_status_enum has all required enum values
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status_enum') THEN
        BEGIN
            ALTER TYPE user_status_enum ADD VALUE IF NOT EXISTS 'active';
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER TYPE user_status_enum ADD VALUE IF NOT EXISTS 'suspended';
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER TYPE user_status_enum ADD VALUE IF NOT EXISTS 'banned';
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER TYPE user_status_enum ADD VALUE IF NOT EXISTS 'deleted';
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            ALTER TYPE user_status_enum ADD VALUE IF NOT EXISTS 'inactive';
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;

-- 2. Helper function to generate clean unique usernames
CREATE OR REPLACE FUNCTION public.generate_system_username()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_adjectives TEXT[] := ARRAY['alpha', 'beta', 'crypto', 'swift', 'prime', 'hyper', 'apex', 'delta', 'vortex', 'stellar', 'pulse', 'sonic', 'turbo', 'nexus', 'quantum'];
    v_nouns TEXT[] := ARRAY['trader', 'vault', 'user', 'pilot', 'runner', 'node', 'fox', 'hawk', 'pax', 'shield', 'whale', 'spark', 'core', 'wave', 'stream'];
    v_username TEXT;
    v_candidate TEXT;
    v_tries INT := 0;
BEGIN
    LOOP
        v_candidate := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int] ||
                       v_nouns[1 + floor(random() * array_length(v_nouns, 1))::int] ||
                       floor(1000 + random() * 9000)::text;
        
        IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = v_candidate) THEN
            v_username := v_candidate;
            EXIT;
        END IF;

        v_tries := v_tries + 1;
        IF v_tries > 20 THEN
            v_username := 'user_' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 8);
            EXIT;
        END IF;
    END LOOP;

    RETURN v_username;
END;
$$;

-- 3. Robust, Fault-Tolerant handle_new_user() trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_username TEXT;
    v_full_name TEXT;
    v_avatar_url TEXT;
    v_dob DATE;
    v_sec_q TEXT;
    v_sec_a TEXT;
    v_has_onboarding BOOLEAN := FALSE;
    v_country TEXT;
    v_raw_dob TEXT;
    v_asset TEXT;
BEGIN
    -- Extract full name from metadata
    v_full_name := COALESCE(
        NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'name'), ''),
        NULLIF(TRIM(NEW.raw_user_meta_data->>'displayName'), ''),
        ''
    );

    -- Extract avatar URL from metadata
    v_avatar_url := COALESCE(
        NEW.raw_user_meta_data->>'avatar_url',
        NEW.raw_user_meta_data->>'picture',
        NEW.raw_user_meta_data->>'photo_url'
    );

    -- Extract DOB
    v_raw_dob := COALESCE(NEW.raw_user_meta_data->>'dob', NEW.raw_user_meta_data->>'date_of_birth');
    IF v_raw_dob IS NOT NULL AND v_raw_dob ~ '^\d{4}-\d{2}-\d{2}$' THEN
        BEGIN
            v_dob := v_raw_dob::DATE;
        EXCEPTION WHEN OTHERS THEN
            v_dob := NULL;
        END;
    END IF;

    -- Extract security questions
    v_sec_q := COALESCE(NEW.raw_user_meta_data->>'security_question', NEW.raw_user_meta_data->>'securityQuestion');
    v_sec_a := COALESCE(NEW.raw_user_meta_data->>'security_answer', NEW.raw_user_meta_data->>'securityAnswer');

    IF v_full_name != '' AND v_dob IS NOT NULL AND v_sec_q IS NOT NULL AND v_sec_a IS NOT NULL THEN
        v_has_onboarding := TRUE;
    END IF;

    v_country := COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'country'), ''), 'IN');

    -- Extract or auto-generate unique username
    IF NEW.raw_user_meta_data->>'username' IS NOT NULL AND length(TRIM(NEW.raw_user_meta_data->>'username')) >= 3 THEN
        v_username := lower(regexp_replace(TRIM(NEW.raw_user_meta_data->>'username'), '[^a-z0-9._]', '', 'g'));
        IF EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username) THEN
            v_username := public.generate_system_username();
        END IF;
    ELSE
        v_username := public.generate_system_username();
    END IF;

    -- 1. Insert or Update Profile Record
    BEGIN
        INSERT INTO public.profiles (
            id,
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
            v_username,
            v_username,
            v_full_name,
            v_full_name,
            NEW.email,
            v_dob,
            v_dob,
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
            'active'::user_status_enum,
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
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'handle_new_user profile creation warning: %', SQLERRM;
    END;

    -- 2. Initialize wallet_assets for standard assets (USDT, BTC, ETH, LTC)
    BEGIN
        FOREACH v_asset IN ARRAY ARRAY['USDT', 'BTC', 'ETH', 'LTC'] LOOP
            INSERT INTO public.wallet_assets (
                user_id,
                asset_symbol,
                balance,
                locked_balance,
                reserved_balance,
                in_escrow,
                in_withdrawal,
                created_at,
                updated_at
            )
            VALUES (
                NEW.id,
                v_asset,
                0.00000000,
                0.00000000,
                0.00000000,
                0.00000000,
                0.00000000,
                NOW(),
                NOW()
            )
            ON CONFLICT DO NOTHING;
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'handle_new_user wallet_assets initialization warning: %', SQLERRM;
    END;

    -- 3. Initialize user_balances for standard assets
    BEGIN
        FOREACH v_asset IN ARRAY ARRAY['USDT', 'BTC', 'ETH', 'LTC'] LOOP
            INSERT INTO public.user_balances (
                user_id,
                asset,
                asset_symbol,
                available_balance,
                locked_balance,
                balance,
                amount,
                created_at,
                updated_at
            )
            VALUES (
                NEW.id,
                v_asset,
                v_asset,
                0.00000000,
                0.00000000,
                0.00000000,
                0.00000000,
                NOW(),
                NOW()
            )
            ON CONFLICT DO NOTHING;
        END LOOP;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'handle_new_user user_balances initialization warning: %', SQLERRM;
    END;

    RETURN NEW;
END;
$$;

-- 4. Re-bind trigger to auth.users table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
