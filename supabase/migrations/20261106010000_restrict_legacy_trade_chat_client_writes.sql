-- The canonical buyer/seller chat stream is public.trade_messages.
-- public.trade_chat_messages is a compatibility/moderator stream: user clients
-- must not be able to inject messages into any trade by choosing a trade_id.
BEGIN;

DO $guard$
BEGIN
    IF to_regclass('public.trade_chat_messages') IS NULL THEN
        RAISE EXCEPTION 'Required legacy chat compatibility table is missing; refusing to apply chat access changes.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'trade_chat_messages'
          AND c.relrowsecurity IS TRUE
    ) THEN
        RAISE EXCEPTION 'RLS must remain enabled on public.trade_chat_messages; refusing unsafe access change.';
    END IF;
END;
$guard$;

-- Remove every INSERT / ALL policy. PostgreSQL permissive policies are ORed,
-- so removing only the known weak sender_id policy is not a sufficient guard.
DO $policies$
DECLARE
    v_policy record;
BEGIN
    FOR v_policy IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'trade_chat_messages'
          AND cmd IN ('INSERT', 'ALL')
    LOOP
        EXECUTE format(
            'DROP POLICY %I ON public.trade_chat_messages',
            v_policy.policyname
        );
    END LOOP;
END;
$policies$;

-- Keep participant-scoped SELECT policies intact, but remove every direct
-- browser mutation privilege. Trusted moderator/system APIs use service_role.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.trade_chat_messages
    FROM PUBLIC, anon, authenticated;

GRANT ALL PRIVILEGES
    ON TABLE public.trade_chat_messages
    TO service_role;

COMMENT ON TABLE public.trade_chat_messages IS
    'Compatibility/moderator chat stream. Participant reads remain RLS-filtered; client writes are disabled. Canonical buyer/seller messages use trade_messages; moderator/system copies are written server-side.';

-- Fail closed if a future permissive policy or inherited table grant would
-- restore direct browser writes.
DO $verify$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'trade_chat_messages'
          AND c.relrowsecurity IS TRUE
    ) THEN
        RAISE EXCEPTION 'RLS was unexpectedly disabled on trade_chat_messages.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'trade_chat_messages'
          AND cmd IN ('INSERT', 'ALL')
    ) THEN
        RAISE EXCEPTION 'An INSERT/ALL policy remains on trade_chat_messages.';
    END IF;

    IF has_table_privilege('anon', 'public.trade_chat_messages', 'INSERT')
       OR has_table_privilege('anon', 'public.trade_chat_messages', 'UPDATE')
       OR has_table_privilege('anon', 'public.trade_chat_messages', 'DELETE')
       OR has_table_privilege('authenticated', 'public.trade_chat_messages', 'INSERT')
       OR has_table_privilege('authenticated', 'public.trade_chat_messages', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.trade_chat_messages', 'DELETE')
       OR has_table_privilege('anon', 'public.trade_chat_messages', 'TRUNCATE')
       OR has_table_privilege('anon', 'public.trade_chat_messages', 'REFERENCES')
       OR has_table_privilege('anon', 'public.trade_chat_messages', 'TRIGGER')
       OR has_table_privilege('authenticated', 'public.trade_chat_messages', 'TRUNCATE')
       OR has_table_privilege('authenticated', 'public.trade_chat_messages', 'REFERENCES')
       OR has_table_privilege('authenticated', 'public.trade_chat_messages', 'TRIGGER') THEN
        RAISE EXCEPTION 'Browser DML privilege remains on trade_chat_messages.';
    END IF;

    IF NOT has_table_privilege('service_role', 'public.trade_chat_messages', 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.trade_chat_messages', 'UPDATE')
       OR NOT has_table_privilege('service_role', 'public.trade_chat_messages', 'DELETE')
       OR NOT has_table_privilege('service_role', 'public.trade_chat_messages', 'TRUNCATE')
       OR NOT has_table_privilege('service_role', 'public.trade_chat_messages', 'REFERENCES')
       OR NOT has_table_privilege('service_role', 'public.trade_chat_messages', 'TRIGGER') THEN
        RAISE EXCEPTION 'Service-role compatibility writes were not preserved.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'trade_chat_messages'
          AND cmd = 'SELECT'
    ) THEN
        RAISE EXCEPTION 'Existing participant/admin read policy was not preserved.';
    END IF;
END;
$verify$;

COMMIT;
