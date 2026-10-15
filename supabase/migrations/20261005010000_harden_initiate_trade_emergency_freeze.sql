-- ============================================================================
-- Superseded migration compatibility note
--
-- The original version of this migration attempted to compile
-- public.initiate_trade_with_escrow against public.p2p_ads, including a
-- %ROWTYPE declaration. The repository's canonical ads schema is public.ads;
-- public.p2p_ads is not created by the migration history. This caused clean
-- database replay to fail before later migrations could run.
--
-- Keep this historical migration as a no-op. The later migration
-- 20261007010000_canonical_public_ads_identifier_resolution.sql installs the
-- canonical initiate_trade_with_escrow implementation against public.ads and
-- includes the platform freeze / pending-withdrawal checks. Do not add a
-- p2p_ads compatibility table here: that would create a second source of
-- truth for advertisements.
-- ============================================================================
BEGIN;
COMMIT;
