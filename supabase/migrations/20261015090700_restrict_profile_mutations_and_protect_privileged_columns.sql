REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE (
  full_name, photo_url, username, name_visibility, preferred_currency,
  avatar_url, dob, country, address_street, address_city, address_postal_code,
  name_privacy, preferred_fiat, name, date_of_birth, display_name,
  address, country_code, username_changed, username_changed_at,
  username_changes_remaining, blocked_users, onboarding_completed,
  terms_accepted_at
) ON TABLE public.profiles TO authenticated;