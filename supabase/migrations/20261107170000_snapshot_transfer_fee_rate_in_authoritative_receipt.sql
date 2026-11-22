-- Return the fee-rate snapshot used for the committed transfer, not the
-- potentially newer app_settings value read before the RPC by the API route.
-- The canonical transfer RPC already persists fee_rate to the sender ledger row.
BEGIN;

DO $dependency$
DECLARE
    v_definition text;
BEGIN
    IF to_regprocedure('public.execute_internal_transfer(uuid,text,text,numeric,text)') IS NULL
       OR to_regclass('public.transfers') IS NULL
       OR to_regclass('public.ledger_entries') IS NULL THEN
        RAISE EXCEPTION 'Canonical transfer function or receipt/ledger tables are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='ledger_entries'
          AND column_name='metadata' AND data_type='jsonb'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='ledger_entries'
          AND column_name='reference_id'
    ) THEN
        RAISE EXCEPTION 'Ledger fee-rate snapshot fields are unavailable';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(
        'public.execute_internal_transfer(uuid,text,text,numeric,text)'::regprocedure
    ) INTO v_definition;

    IF pg_catalog.strpos(v_definition, 'public.app_settings') = 0
       OR pg_catalog.strpos(v_definition, '''fee_rate'', v_fee_rate') = 0
       OR pg_catalog.strpos(v_definition, '''total_deduction'', v_total_deduction') = 0
       OR NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid = 'public.execute_internal_transfer(uuid,text,text,numeric,text)'::regprocedure
              AND (
                  'search_path=pg_catalog' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
                  OR 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
              )
       ) THEN
        RAISE EXCEPTION 'Configured-fee transfer migration must be installed before fee snapshot receipt patch';
    END IF;
END;
$dependency$;

DO $patch_transfer_receipts$
DECLARE
    v_definition text;
    v_old text;
    v_new text;
    v_position integer;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.execute_internal_transfer(uuid,text,text,numeric,text)'::regprocedure
    ) INTO v_definition;

    v_old := '    v_fee_rate NUMERIC(10, 6);';
    IF pg_catalog.strpos(v_definition, v_old) = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, pg_catalog.strpos(v_definition, v_old) + pg_catalog.length(v_old)),
            v_old
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate transfer fee-rate variable declaration';
    END IF;

    v_definition := pg_catalog.replace(
        v_definition,
        v_old,
        v_old || E'\n    v_existing_fee_rate NUMERIC;'
    );

    -- Read the fee snapshot from the committed SENT ledger row. Historical
    -- records without a snapshot return NULL; their immutable amount/fee
    -- arithmetic is still verified by the API, without applying today's rate.
    v_old := $marker$
        RETURN jsonb_build_object(
            'success', true,
            'transfer_id', v_existing_transfer.id,
$marker$;
    v_new := $replacement$
        SELECT (metadata->>'fee_rate')::numeric
          INTO v_existing_fee_rate
          FROM public.ledger_entries
         WHERE user_id = p_sender_id
           AND reference_id = v_existing_transfer.id::text
           AND metadata->>'direction' = 'SENT'
           AND NULLIF(pg_catalog.btrim(metadata->>'fee_rate'), '') IS NOT NULL
         ORDER BY created_at ASC, id ASC
         LIMIT 1;

        RETURN jsonb_build_object(
            'success', true,
            'transfer_id', v_existing_transfer.id,
$replacement$;

    v_position := pg_catalog.strpos(v_definition, v_old);
    IF v_position = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_old)),
            v_old
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate idempotent transfer receipt return';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    v_old := $marker$            'total_deduction', v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0),
            'legacy_fee_model',$marker$;
    v_new := $replacement$            'total_deduction', v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0),
            'fee_rate', v_existing_fee_rate,
            'legacy_fee_model',$replacement$;

    v_position := pg_catalog.strpos(v_definition, v_old);
    IF v_position = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_old)),
            v_old
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate idempotent transfer fee receipt fields';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    v_old := $marker$        'total_deduction', v_total_deduction,
        'legacy_fee_model', FALSE,$marker$;
    v_new := $replacement$        'total_deduction', v_total_deduction,
        'fee_rate', v_fee_rate,
        'legacy_fee_model', FALSE,$replacement$;

    v_position := pg_catalog.strpos(v_definition, v_old);
    IF v_position = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, v_position + pg_catalog.length(v_old)),
            v_old
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not uniquely locate new transfer fee receipt fields';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);

    IF pg_catalog.strpos(v_definition, 'v_existing_fee_rate NUMERIC') = 0
       OR pg_catalog.strpos(v_definition, '''fee_rate'', v_existing_fee_rate') = 0
       OR pg_catalog.strpos(v_definition, '''fee_rate'', v_fee_rate') = 0
       OR pg_catalog.strpos(v_definition, 'metadata->>''direction'' = ''SENT''') = 0 THEN
        RAISE EXCEPTION 'Transfer fee snapshot receipt patch verification failed';
    END IF;

    EXECUTE v_definition;
END;
$patch_transfer_receipts$;

NOTIFY pgrst, 'reload schema';

COMMIT;
