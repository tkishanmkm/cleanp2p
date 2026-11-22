CREATE TABLE IF NOT EXISTS public.kyc_identity_fingerprints (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  id_document_number_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_identity_document_hash_format
    CHECK (id_document_number_hash ~ '^[0-9a-f]{64}$')
);
ALTER TABLE public.kyc_identity_fingerprints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kyc_identity_fingerprints FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kyc_identity_fingerprints TO service_role;