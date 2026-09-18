-- ==============================================================================
-- Supabase Migration: 20260918000000_fix_oauth_username_and_defaults.sql
-- Description:
--   1. Ensures profiles table has columns for username_changed, username_changes_remaining,
--      and username_changed_count with proper default values.
--   2. Updates existing profiles where username_changed is NULL or 0 to have 1 change available.
--   3. Updates handle_new_user() trigger to explicitly initialize username change columns
--      so OAuth signups receive their 1-time username change entitlement properly.
-- ==============================================================================

-- 1. Ensure columns exist and have proper defaults on public.profiles
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'username_changed'
    ) THEN
        ALTER TABLE public.profiles ALTER COLUMN username_changed SET DEFAULT FALSE;
    ELSE
        ALTER TABLE public.profiles ADD COLUMN username_changed BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'username_changes_remaining'
    ) THEN
        ALTER TABLE public.profiles ALTER COLUMN username_changes_remaining SET DEFAULT 1;
    ELSE
        ALTER TABLE public.profiles ADD COLUMN username_changes_remaining INT NOT NULL DEFAULT 1;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'username_changed_count'
    ) THEN
        ALTER TABLE public.profiles ALTER COLUMN username_changed_count SET DEFAULT 0;
    ELSE
        ALTER TABLE public.profiles ADD COLUMN username_changed_count INT NOT NULL DEFAULT 0;
    END IF;
END $$;

-- 2. Backfill existing profiles where username has never been changed
UPDATE public.profiles
SET username_changed = FALSE,
    username_changes_remaining = 1,
    username_changed_count = 0
WHERE (username_changed IS NULL OR username_changed = FALSE)
  AND (username_changed_count IS NULL OR username_changed_count = 0);

-- 3. Update handle_new_user() trigger function to explicitly set username change permissions
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_username TEXT;
    v_full_name TEXT;
    v_wallet_id UUID;
    v_asset RECORD;
    v_dob TEXT;
    v_sec_q TEXT;
    v_sec_a TEXT;
    v_avatar_url TEXT;
    v_has_onboarding BOOLEAN := FALSE;
BEGIN
    -- Extract full name from metadata
    v_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        NEW.raw_user_meta_data->>'displayName',
        ''
    );

    -- Extract avatar / photo URL if provided by OAuth provider (e.g. Google)
    v_avatar_url := COALESCE(
        NEW.raw_user_meta_data->>'avatar_url',
        NEW.raw_user_meta_data->>'picture',
        NEW.raw_user_meta_data->>'photo_url'
    );

    -- Extract metadata if present
    v_dob := COALESCE(NEW.raw_user_meta_data->>'dob', NEW.raw_user_meta_data->>'date_of_birth');
    v_sec_q := COALESCE(NEW.raw_user_meta_data->>'security_question', NEW.raw_user_meta_data->>'securityQuestion');
    v_sec_a := COALESCE(NEW.raw_user_meta_data->>'security_answer', NEW.raw_user_meta_data->>'securityAnswer');

    IF v_full_name != '' AND v_dob IS NOT NULL AND v_sec_q IS NOT NULL AND v_sec_a IS NOT NULL THEN
        v_has_onboarding := TRUE;
    END IF;

    -- Extract or auto-generate username matching 5-25 chars (e.g. forcecall33, speedhui66, energyman6338)
    IF NEW.raw_user_meta_data->>'username' IS NOT NULL AND length(NEW.raw_user_meta_data->>'username') >= 5 THEN
        v_username := lower(regexp_replace(NEW.raw_user_meta_data->>'username', '[^a-z0-9._]', '', 'g'));
        -- Check collision
        IF EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username) THEN
            v_username := public.generate_system_username();
        END IF;
    ELSE
        v_username := public.generate_system_username();
    END IF;

    -- Ensure final length is strictly 5 to 25 characters
    IF length(v_username) < 5 OR length(v_username) > 25 THEN
        v_username := public.generate_system_username();
    END IF;

    -- 1. Create Profile:
    -- Username is also display_name. Full name is saved into full_name and name.
    -- Explicitly set username_changed = FALSE, username_changes_remaining = 1, username_changed_count = 0
    INSERT INTO public.profiles (
        id,
        username,
        display_name,
        full_name,
        name,
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
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        v_username,
        v_username,
        v_full_name,
        v_full_name,
        v_dob,
        v_dob,
        v_sec_q,
        v_sec_a,
        v_has_onboarding,
        v_avatar_url,
        v_avatar_url,
        COALESCE(NEW.raw_user_meta_data->>'country', 'US'),
        'USD',
        FALSE,
        1,
        0,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = CASE WHEN EXCLUDED.full_name != '' THEN EXCLUDED.full_name ELSE public.profiles.full_name END,
        name = CASE WHEN EXCLUDED.name != '' THEN EXCLUDED.name ELSE public.profiles.name END,
        dob = COALESCE(EXCLUDED.dob, public.profiles.dob),
        date_of_birth = COALESCE(EXCLUDED.date_of_birth, public.profiles.date_of_birth),
        avatar_url = COALESCE(public.profiles.avatar_url, EXCLUDED.avatar_url),
        photo_url = COALESCE(public.profiles.photo_url, EXCLUDED.photo_url),
        username_changed = COALESCE(public.profiles.username_changed, FALSE),
        username_changes_remaining = COALESCE(public.profiles.username_changes_remaining, 1),
        username_changed_count = COALESCE(public.profiles.username_changed_count, 0),
        updated_at = NOW();

    -- 2. Create Core Wallet
    INSERT INTO public.wallets (user_id, status, provisioning_status)
    VALUES (NEW.id, 'active', 'pending')
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_wallet_id;

    IF v_wallet_id IS NULL THEN
        SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = NEW.id LIMIT 1;
    END IF;

    -- 3. Initialize wallet_assets for all enabled assets
    IF v_wallet_id IS NOT NULL THEN
        FOR v_asset IN SELECT code FROM public.assets WHERE is_enabled = TRUE LOOP
            INSERT INTO public.wallet_assets (wallet_id, asset_code, available, locked_escrow, locked_withdrawal)
            VALUES (v_wallet_id, v_asset.code, 0.0, 0.0, 0.0)
            ON CONFLICT (wallet_id, asset_code) DO NOTHING;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$;
