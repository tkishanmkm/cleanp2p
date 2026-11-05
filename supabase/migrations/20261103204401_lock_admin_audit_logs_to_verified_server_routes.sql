BEGIN;

DROP POLICY IF EXISTS "Admins can view audit logs"
  ON public.admin_audit_logs;

REVOKE ALL PRIVILEGES ON TABLE public.admin_audit_logs
  FROM PUBLIC, anon, authenticated;

-- Admin audit log reads and writes are performed only by server code after
-- verifyProvisionedAdmin/verifyWithdrawalAdmin validates the session and 2FA.
-- service_role retains its existing table privileges.

COMMIT;
