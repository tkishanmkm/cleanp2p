-- Read-only post-apply verification for trade_chat_messages write hardening.
DO $check$
BEGIN
    IF to_regclass('public.trade_chat_messages') IS NULL THEN
        RAISE EXCEPTION 'FAIL: public.trade_chat_messages is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'trade_chat_messages'
          AND c.relrowsecurity IS TRUE
    ) THEN
        RAISE EXCEPTION 'FAIL: RLS is not enabled';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'trade_chat_messages'
          AND cmd IN ('INSERT', 'ALL')
    ) THEN
        RAISE EXCEPTION 'FAIL: a client write policy still exists';
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
        RAISE EXCEPTION 'FAIL: a browser role retains DML privileges';
    END IF;

    IF NOT has_table_privilege('service_role', 'public.trade_chat_messages', 'INSERT')
       OR NOT has_table_privilege('service_role', 'public.trade_chat_messages', 'UPDATE')
       OR NOT has_table_privilege('service_role', 'public.trade_chat_messages', 'DELETE')
       OR NOT has_table_privilege('service_role', 'public.trade_chat_messages', 'TRUNCATE')
       OR NOT has_table_privilege('service_role', 'public.trade_chat_messages', 'REFERENCES')
       OR NOT has_table_privilege('service_role', 'public.trade_chat_messages', 'TRIGGER') THEN
        RAISE EXCEPTION 'FAIL: trusted server writes are not preserved';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'trade_chat_messages'
          AND cmd = 'SELECT'
    ) THEN
        RAISE EXCEPTION 'FAIL: participant/admin SELECT policy is missing';
    END IF;

    RAISE NOTICE 'PASS: legacy chat writes are server-only; RLS and SELECT policy remain enabled';
END;
$check$;
