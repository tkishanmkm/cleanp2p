-- Prevent self-service profile updates from changing authorization, MFA,
-- KYC, custody, or account-control fields. Trusted service-role server paths
-- remain able to update these fields after their own authorization checks.
CREATE OR REPLACE FUNCTION public.prevent_self_service_security_field_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF OLD.role IS DISTINCT FROM NEW.role
     OR OLD.is_admin IS DISTINCT FROM NEW.is_admin
     OR OLD.is_admin_account IS DISTINCT FROM NEW.is_admin_account
     OR OLD.admin_2fa_enabled IS DISTINCT FROM NEW.admin_2fa_enabled
     OR OLD.admin_2fa_secret IS DISTINCT FROM NEW.admin_2fa_secret
     OR OLD.admin_2fa_recovery_hash IS DISTINCT FROM NEW.admin_2fa_recovery_hash
     OR OLD.admin_2fa_recovery_updated_at IS DISTINCT FROM NEW.admin_2fa_recovery_updated_at
     OR OLD.is_2fa_enabled IS DISTINCT FROM NEW.is_2fa_enabled
     OR OLD.is_mfa_enabled IS DISTINCT FROM NEW.is_mfa_enabled
     OR OLD.two_factor_enabled IS DISTINCT FROM NEW.two_factor_enabled
     OR OLD.two_factor_secret IS DISTINCT FROM NEW.two_factor_secret
     OR OLD.totp_secret IS DISTINCT FROM NEW.totp_secret
     OR OLD.security_question IS DISTINCT FROM NEW.security_question
     OR OLD.security_answer_hash IS DISTINCT FROM NEW.security_answer_hash
     OR OLD.security_answer IS DISTINCT FROM NEW.security_answer
     OR OLD.kyc_status IS DISTINCT FROM NEW.kyc_status
     OR OLD.kyc_vendor_session_id IS DISTINCT FROM NEW.kyc_vendor_session_id
     OR OLD.didit_session_id IS DISTINCT FROM NEW.didit_session_id
     OR OLD.kyc_attempts IS DISTINCT FROM NEW.kyc_attempts
     OR OLD.kyc_retry_count IS DISTINCT FROM NEW.kyc_retry_count
     OR OLD.kyc_retry_after IS DISTINCT FROM NEW.kyc_retry_after
     OR OLD.kyc_approved_at IS DISTINCT FROM NEW.kyc_approved_at
     OR OLD.kyc_submitted_at IS DISTINCT FROM NEW.kyc_submitted_at
     OR OLD.is_verified IS DISTINCT FROM NEW.is_verified
     OR OLD.id_verified IS DISTINCT FROM NEW.id_verified
     OR OLD.email_verified IS DISTINCT FROM NEW.email_verified
     OR OLD.is_kyc_locked IS DISTINCT FROM NEW.is_kyc_locked
     OR OLD.is_minor_restricted IS DISTINCT FROM NEW.is_minor_restricted
     OR OLD.wallet_index IS DISTINCT FROM NEW.wallet_index
     OR OLD.evm_deposit_address IS DISTINCT FROM NEW.evm_deposit_address
     OR OLD.tron_deposit_address IS DISTINCT FROM NEW.tron_deposit_address
     OR OLD.btc_deposit_address IS DISTINCT FROM NEW.btc_deposit_address
     OR OLD.ltc_deposit_address IS DISTINCT FROM NEW.ltc_deposit_address
     OR OLD.is_banned IS DISTINCT FROM NEW.is_banned
     OR OLD.is_on_hold IS DISTINCT FROM NEW.is_on_hold
     OR OLD.is_suspended IS DISTINCT FROM NEW.is_suspended
     OR OLD.is_restricted IS DISTINCT FROM NEW.is_restricted
     OR OLD.account_status IS DISTINCT FROM NEW.account_status
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.ban_reason IS DISTINCT FROM NEW.ban_reason
     OR OLD.ban_policy IS DISTINCT FROM NEW.ban_policy
     OR OLD.is_country_locked IS DISTINCT FROM NEW.is_country_locked
     OR OLD.is_address_locked IS DISTINCT FROM NEW.is_address_locked
     OR OLD.is_emergency_frozen IS DISTINCT FROM NEW.is_emergency_frozen
     OR OLD.emergency_frozen_at IS DISTINCT FROM NEW.emergency_frozen_at
     OR OLD.emergency_frozen_by IS DISTINCT FROM NEW.emergency_frozen_by
     OR OLD.emergency_freeze_reason IS DISTINCT FROM NEW.emergency_freeze_reason
     OR OLD.is_withdrawal_locked IS DISTINCT FROM NEW.is_withdrawal_locked
     OR OLD.withdrawals_disabled IS DISTINCT FROM NEW.withdrawals_disabled
     OR OLD.verification_tier IS DISTINCT FROM NEW.verification_tier
  THEN
    RAISE EXCEPTION 'Security-sensitive profile fields can only be changed by trusted server operations.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_self_service_security_field_changes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_protect_profile_security_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_security_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_service_security_field_changes();
