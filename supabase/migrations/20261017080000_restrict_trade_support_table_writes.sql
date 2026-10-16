-- Harden trade support tables: participants may read authorized records and
-- send messages/upload attachments only through their specific RLS policies.
-- Client roles must not edit/delete audit, dispute, report, or message history.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.trade_attachments FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.trade_attachments FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.trade_attachments TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.trade_chat_messages FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.trade_chat_messages FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.trade_chat_messages TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.trade_disputes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.trade_disputes FROM authenticated;
GRANT SELECT ON TABLE public.trade_disputes TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.trade_files FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.trade_files FROM authenticated;
GRANT SELECT ON TABLE public.trade_files TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.trade_messages FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.trade_messages FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.trade_messages TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.trade_reports FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.trade_reports FROM authenticated;
GRANT SELECT ON TABLE public.trade_reports TO authenticated;

COMMIT;
