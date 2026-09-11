-- ==============================================================================
-- Supabase Migration: 20260910000002_onboarding_and_username_system.sql
-- Description:
--   1. Ensures profiles table has columns for full_name, dob, date_of_birth,
--      security_question, security_answer, security_answer_hash, onboarding_completed,
--      is_2fa_enabled, is_mfa_enabled, and two_factor_secret.
--   2. Updates handle_new_user() trigger to generate usernames formatted as
--      5-25 lowercase letters, digits, '.', and '_' (e.g. forcecall33, speedhui66, energyman6338),
--      auto-saves full_name from signup, and sets display_name = username.
-- ==============================================================================

-- 1. Ensure all required columns exist on public.profiles
ALTER TABLE IF EXISTS public.profiles 
    ADD COLUMN IF NOT EXISTS full_name TEXT,
    ADD COLUMN IF NOT EXISTS name TEXT,
    ADD COLUMN IF NOT EXISTS dob TEXT,
    ADD COLUMN IF NOT EXISTS date_of_birth TEXT,
    ADD COLUMN IF NOT EXISTS security_question TEXT,
    ADD COLUMN IF NOT EXISTS security_answer TEXT,
    ADD COLUMN IF NOT EXISTS security_answer_hash TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;

-- 2. Create username generator helper function in PostgreSQL
CREATE OR REPLACE FUNCTION public.generate_system_username()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_prefixes TEXT[] := ARRAY['force', 'speed', 'energy', 'power', 'swift', 'quick', 'hyper', 'cyber', 'apex', 'turbo', 'shadow', 'smart', 'vortex', 'crypto', 'prime', 'bold', 'flash', 'star', 'alpha', 'delta', 'pulse', 'ultra', 'solid', 'storm', 'fire', 'iron', 'titan', 'bright'];
    v_roots TEXT[] := ARRAY['call', 'hui', 'man', 'core', 'wave', 'link', 'node', 'hub', 'flow', 'run', 'dex', 'fox', 'bot', 'trader', 'vault', 'zone', 'byte', 'hawk', 'ray', 'peak', 'grid', 'pulse', 'flex', 'nest', 'spark', 'sync'];
    v_separators TEXT[] := ARRAY['', '', '', '', '_', '.'];
    v_prefix TEXT;
    v_root TEXT;
    v_sep TEXT;
    v_num INT;
    v_candidate TEXT;
    v_attempts INT := 0;
BEGIN
    LOOP
        v_attempts := v_attempts + 1;
        v_prefix := v_prefixes[1 + floor(random() * array_length(v_prefixes, 1))::int];
        v_root := v_roots[1 + floor(random() * array_length(v_roots, 1))::int];
        v_sep := v_separators[1 + floor(random() * array_length(v_separators, 1))::int];
        
        -- Generate 2-4 digit number (e.g., 33, 66, 6338)
        IF random() < 0.4 THEN
            v_num := floor(10 + random() * 90)::int; -- 2 digits (e.g. 33, 66)
        ELSIF random() < 0.7 THEN
            v_num := floor(100 + random() * 900)::int; -- 3 digits
        ELSE
            v_num := floor(1000 + random() * 9000)::int; -- 4 digits (e.g. 6338)
        END IF;

        v_candidate := lower(v_prefix || v_root || v_sep || v_num::text);

        -- Ensure 5 to 25 characters and matches regex
        IF length(v_candidate) >= 5 AND length(v_candidate) <= 25 THEN
            IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE username = v_candidate) THEN
                RETURN v_candidate;
            END IF;
        END IF;

        -- Fallback safety after 50 attempts
        IF v_attempts > 50 THEN
            RETURN 'user_' || substr(md5(random()::text), 1, 8);
        END IF;
    END LOOP;
END;
$$;

-- 3. Update auth trigger function handle_new_user
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
    v_has_onboarding BOOLEAN := FALSE;
BEGIN
    -- Extract full name from metadata
    v_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        NEW.raw_user_meta_data->>'displayName',
        ''
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
        country,
        preferred_currency,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        v_username,
        v_username, -- Profile username is display name
        v_full_name,
        v_full_name,
        v_dob,
        v_dob,
        v_sec_q,
        v_sec_a,
        v_has_onboarding,
        NEW.raw_user_meta_data->>'avatar_url',
        COALESCE(NEW.raw_user_meta_data->>'country', 'US'),
        'USD',
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = CASE WHEN EXCLUDED.full_name != '' THEN EXCLUDED.full_name ELSE public.profiles.full_name END,
        name = CASE WHEN EXCLUDED.name != '' THEN EXCLUDED.name ELSE public.profiles.name END,
        dob = COALESCE(EXCLUDED.dob, public.profiles.dob),
        date_of_birth = COALESCE(EXCLUDED.date_of_birth, public.profiles.date_of_birth),
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

-- 4. Ensure trigger is active on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
