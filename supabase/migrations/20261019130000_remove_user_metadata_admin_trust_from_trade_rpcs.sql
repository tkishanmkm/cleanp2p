-- Remove user-editable Auth metadata from admin authorization in trade RPCs.
-- Preserve the exact installed function bodies and ACLs; change only the unsafe
-- predicate. Do not replace functions with older repository snapshots.
-- Apply only after isolated-database validation and explicit deployment approval.
BEGIN;

DO $migration$
DECLARE
    v_signature text;
    v_oid oid;
    v_definition text;
    v_hardened text;
    v_signatures text[] := ARRAY[
        'public.mark_p2p_trade_paid(uuid,uuid,text)',
        'public.raise_trade_dispute(uuid,uuid,text)',
        'public.resolve_trade_dispute(uuid,text,uuid,uuid)',
        'public.expire_p2p_trade(uuid)',
        'public.cancel_expired_p2p_trades()'
    ];
BEGIN
    FOREACH v_signature IN ARRAY v_signatures LOOP
        v_oid := to_regprocedure(v_signature);
        IF v_oid IS NULL THEN
            RAISE EXCEPTION 'Required function % does not exist; refusing partial hardening.', v_signature;
        END IF;

        v_definition := pg_get_functiondef(v_oid);
        -- Replace only the unsafe predicate expression. Preserve surrounding
        -- parentheses and boolean operators so authorization grouping is unchanged.
        v_hardened := regexp_replace(
            v_definition,
            'raw_user_meta_data[[:space:]]*->[[:space:]]*>[[:space:]]*''role''[[:space:]]*=[[:space:]]*''admin''',
            'FALSE',
            'g'
        );

        -- Every user-metadata reference in these five functions was inspected and is
        -- part of an admin-role decision. Fail closed if any such reference survives.
        IF position('raw_user_meta_data' IN v_hardened) > 0 THEN
            RAISE EXCEPTION 'Unsafe user-editable Auth metadata remains in %; refusing to alter it.', v_signature;
        END IF;

        IF v_hardened = v_definition THEN
            -- Idempotent only if the unsafe metadata field is already absent.
            IF position('raw_user_meta_data' IN v_definition) > 0 THEN
                RAISE EXCEPTION 'Could not safely identify the user-metadata admin predicate in %; refusing to alter it.', v_signature;
            END IF;
            CONTINUE;
        END IF;

        EXECUTE v_hardened;
    END LOOP;
END;
$migration$;

COMMIT;
