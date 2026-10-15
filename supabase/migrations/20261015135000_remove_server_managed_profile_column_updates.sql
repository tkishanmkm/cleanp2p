REVOKE UPDATE (
  username_changed, username_changed_at, username_changes_remaining,
  terms_accepted_at, onboarding_completed
) ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (onboarding_completed) ON TABLE public.profiles TO authenticated;
