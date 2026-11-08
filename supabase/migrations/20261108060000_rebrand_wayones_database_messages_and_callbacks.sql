-- Wayones branding-only migration for deployed database-generated messages and callbacks.
-- Replaces visible sender labels, internal audit placeholders and callback origins
-- without changing function signatures, owners, privileges or SECURITY DEFINER settings.
BEGIN;

DO $wayones_branding$
DECLARE
  v_function record;
  v_definition text;
  v_updated_definition text;
  v_updated_count integer := 0;
BEGIN
  FOR v_function IN
    SELECT p.oid
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.prosrc ILIKE '%Paxones Moderator%'
        OR p.prosrc ILIKE '%Paxones System%'
        OR p.prosrc ILIKE '%Paxones administrator%'
        OR p.prosrc ILIKE '%https://paxones.com%'
        OR p.prosrc ILIKE '%@paxones.com%'
        OR p.prosrc ILIKE '%@paxones.internal%'
      )
  LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_function.oid);
    v_updated_definition := v_definition;

    v_updated_definition := replace(v_updated_definition, 'Paxones Moderator', 'Wayones Moderator');
    v_updated_definition := replace(v_updated_definition, 'Paxones System', 'Wayones System');
    v_updated_definition := replace(v_updated_definition, 'Paxones administrator', 'Wayones administrator');
    v_updated_definition := replace(v_updated_definition, 'https://paxones.com', 'https://wayones.com');
    v_updated_definition := replace(v_updated_definition, '@paxones.com', '@wayones.com');
    v_updated_definition := replace(v_updated_definition, '@paxones.internal', '@wayones.internal');

    IF v_updated_definition IS DISTINCT FROM v_definition THEN
      EXECUTE v_updated_definition;
      v_updated_count := v_updated_count + 1;
    END IF;
  END LOOP;

  IF v_updated_count < 1 THEN
    RAISE NOTICE 'No legacy branded database functions required replacement.';
  ELSE
    RAISE NOTICE 'Updated Wayones branding literals in % database functions.', v_updated_count;
  END IF;
END;
$wayones_branding$;

-- The durable trade-event table is introduced by a separate pending schema
-- migration. If it exists when this migration runs, normalize its future default
-- without rewriting any historical chat rows.
DO $wayones_trade_event_default$
BEGIN
  IF pg_catalog.to_regclass('public.trade_system_events') IS NOT NULL THEN
    ALTER TABLE public.trade_system_events
      ALTER COLUMN sender_username SET DEFAULT 'Wayones System';
  END IF;
END;
$wayones_trade_event_default$;

COMMIT;
