REVOKE UPDATE (
  country, country_code, dob, date_of_birth
) ON TABLE public.profiles FROM authenticated;
