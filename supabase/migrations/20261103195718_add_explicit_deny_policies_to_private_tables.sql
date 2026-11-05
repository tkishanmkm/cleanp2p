BEGIN;

CREATE POLICY deny_anon_authenticated_access
  ON public.kyc_identity_fingerprints
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY deny_anon_authenticated_access
  ON public.network_gas_fees
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY deny_anon_authenticated_access
  ON public.onchain_withdrawal_broadcasts
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY deny_anon_authenticated_access
  ON public.onchain_withdrawal_nonce_reservations
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY deny_anon_authenticated_access
  ON public.user_2fa_pending_enrollments
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY deny_anon_authenticated_access
  ON public.user_2fa_recovery_codes
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY deny_anon_authenticated_access
  ON public.user_security_audit_logs
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;
