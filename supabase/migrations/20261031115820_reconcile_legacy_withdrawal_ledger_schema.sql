-- Reconcile the older live withdrawals/ledger_entries shape with the canonical
-- fields consumed by the current server-only financial RPCs.
--
-- Existing legacy columns and checks are preserved. BEFORE INSERT adapters fill
-- legacy-required fields when a canonical RPC writes through the new column set.
-- No balances, ledger rows, withdrawal rows, or deposit rows are backfilled here.
BEGIN;

DO $preflight$
BEGIN
    IF to_regclass('public.wallets') IS NULL
       OR to_regclass('public.withdrawals') IS NULL
       OR to_regclass('public.ledger_entries') IS NULL THEN
        RAISE EXCEPTION 'Financial schema reconciliation preflight failed: wallets, withdrawals, and ledger_entries are required';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'withdrawals'
          AND column_name IN ('user_id', 'amount')
        GROUP BY table_name
        HAVING count(*) = 2
    ) THEN
        RAISE EXCEPTION 'Financial schema reconciliation preflight failed: withdrawals.user_id and withdrawals.amount are required';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ledger_entries'
          AND column_name = 'user_id'
    ) THEN
        RAISE EXCEPTION 'Financial schema reconciliation preflight failed: ledger_entries.user_id is required';
    END IF;

    -- Support both the older live table (amount/type) and the canonical base
    -- schema (delta/entry_type). The compatibility trigger detects columns at
    -- runtime and only mirrors into aliases that actually exist.
    IF (
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ledger_entries'
          AND column_name IN ('amount', 'type')
    ) < 2
    AND (
        SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ledger_entries'
          AND column_name IN ('entry_type', 'delta_available', 'delta_locked', 'available_after', 'locked_after', 'ref_table', 'ref_id', 'idempotency_key')
    ) < 8 THEN
        RAISE EXCEPTION 'Financial schema reconciliation preflight failed: ledger_entries is neither the recognized legacy nor canonical shape';
    END IF;
END;
$preflight$;

ALTER TABLE public.withdrawals
    ADD COLUMN IF NOT EXISTS wallet_id uuid,
    ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.ledger_entries
    ADD COLUMN IF NOT EXISTS wallet_id uuid,
    ADD COLUMN IF NOT EXISTS asset_code text,
    ADD COLUMN IF NOT EXISTS delta_available numeric(36,18),
    ADD COLUMN IF NOT EXISTS delta_locked numeric(36,18),
    ADD COLUMN IF NOT EXISTS available_after numeric(36,18),
    ADD COLUMN IF NOT EXISTS locked_after numeric(36,18),
    ADD COLUMN IF NOT EXISTS entry_type text,
    ADD COLUMN IF NOT EXISTS ref_table text,
    ADD COLUMN IF NOT EXISTS ref_id text,
    ADD COLUMN IF NOT EXISTS idempotency_key text;

DO $constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'public.withdrawals'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'public.wallets'::regclass
          AND c.conkey = ARRAY[
              (SELECT a.attnum FROM pg_attribute a
               WHERE a.attrelid = 'public.withdrawals'::regclass
                 AND a.attname = 'wallet_id' AND NOT a.attisdropped)
          ]::smallint[]
    ) THEN
        ALTER TABLE public.withdrawals
            ADD CONSTRAINT withdrawals_wallet_id_compat_fkey
            FOREIGN KEY (wallet_id) REFERENCES public.wallets(id)
            ON DELETE RESTRICT NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conrelid = 'public.ledger_entries'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'public.wallets'::regclass
          AND c.conkey = ARRAY[
              (SELECT a.attnum FROM pg_attribute a
               WHERE a.attrelid = 'public.ledger_entries'::regclass
                 AND a.attname = 'wallet_id' AND NOT a.attisdropped)
          ]::smallint[]
    ) THEN
        ALTER TABLE public.ledger_entries
            ADD CONSTRAINT ledger_entries_wallet_id_compat_fkey
            FOREIGN KEY (wallet_id) REFERENCES public.wallets(id)
            ON DELETE RESTRICT NOT VALID;
    END IF;
END;
$constraints$;

DO $indexes$
DECLARE
    v_withdrawal_attnum smallint;
    v_ledger_attnum smallint;
BEGIN
    SELECT attnum INTO v_withdrawal_attnum
    FROM pg_attribute
    WHERE attrelid = 'public.withdrawals'::regclass
      AND attname = 'idempotency_key' AND NOT attisdropped;

    IF NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = 'public.withdrawals'::regclass
          AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
          AND i.indnkeyatts = 1 AND i.indkey[0] = v_withdrawal_attnum
    ) THEN
        CREATE UNIQUE INDEX uq_withdrawals_idempotency_key_compat
            ON public.withdrawals (idempotency_key);
    END IF;

    SELECT attnum INTO v_ledger_attnum
    FROM pg_attribute
    WHERE attrelid = 'public.ledger_entries'::regclass
      AND attname = 'idempotency_key' AND NOT attisdropped;

    IF NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = 'public.ledger_entries'::regclass
          AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL
          AND i.indnkeyatts = 1 AND i.indkey[0] = v_ledger_attnum
    ) THEN
        CREATE UNIQUE INDEX uq_ledger_entries_idempotency_key_compat
            ON public.ledger_entries (idempotency_key);
    END IF;
END;
$indexes$;

CREATE OR REPLACE FUNCTION public.sync_withdrawals_legacy_insert_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
    v_row jsonb := to_jsonb(NEW);
    v_patch jsonb := '{}'::jsonb;
BEGIN
    IF v_row ? 'chain' AND NULLIF(BTRIM(v_row->>'chain'), '') IS NULL THEN
        v_patch := v_patch || jsonb_build_object(
            'chain', COALESCE(NULLIF(BTRIM(v_row->>'network'), ''),
                              NULLIF(BTRIM(v_row->>'network_code'), ''))
        );
    END IF;

    IF v_row ? 'token_symbol' AND NULLIF(BTRIM(v_row->>'token_symbol'), '') IS NULL THEN
        v_patch := v_patch || jsonb_build_object(
            'token_symbol', COALESCE(NULLIF(BTRIM(v_row->>'asset_symbol'), ''),
                                     NULLIF(BTRIM(v_row->>'asset_code'), ''),
                                     NULLIF(BTRIM(v_row->>'asset'), ''))
        );
    END IF;

    IF v_row ? 'to_address' AND NULLIF(BTRIM(v_row->>'to_address'), '') IS NULL THEN
        v_patch := v_patch || jsonb_build_object(
            'to_address', COALESCE(NULLIF(BTRIM(v_row->>'destination_address'), ''), '')
        );
    END IF;

    IF v_row ? 'idempotency_key' AND NULLIF(BTRIM(v_row->>'idempotency_key'), '') IS NULL THEN
        v_patch := v_patch || jsonb_build_object(
            'idempotency_key', 'w_' || COALESCE(v_row->>'id', gen_random_uuid()::text)
        );
    END IF;

    NEW := jsonb_populate_record(NEW, v_patch);
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_withdrawals_legacy_insert_columns ON public.withdrawals;
CREATE TRIGGER trg_sync_withdrawals_legacy_insert_columns
    BEFORE INSERT ON public.withdrawals
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_withdrawals_legacy_insert_columns();

CREATE OR REPLACE FUNCTION public.sync_ledger_entries_legacy_insert_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
    v_row jsonb := to_jsonb(NEW);
    v_patch jsonb := '{}'::jsonb;
    v_entry_type text := NULL;
    v_legacy_type text := NULL;
    v_asset text := NULL;
    v_delta_available numeric := 0;
    v_delta_locked numeric := 0;
    v_amount numeric := 0;
BEGIN
    v_entry_type := NULLIF(BTRIM(v_row->>'entry_type'), '');

    IF v_entry_type IS NULL THEN
        RETURN NEW;
    END IF;

    v_asset := COALESCE(
        NULLIF(BTRIM(v_row->>'asset_code'), ''),
        NULLIF(BTRIM(v_row->>'crypto'), ''),
        NULLIF(BTRIM(v_row->>'asset'), '')
    );
    v_delta_available := COALESCE(NULLIF(v_row->>'delta_available', '')::numeric, 0);
    v_delta_locked := COALESCE(NULLIF(v_row->>'delta_locked', '')::numeric, 0);
    v_amount := CASE
        WHEN v_delta_available <> 0 THEN v_delta_available
        WHEN v_delta_locked <> 0 THEN v_delta_locked
        ELSE 0
    END;

    v_legacy_type := CASE v_entry_type
        WHEN 'deposit_credit' THEN 'deposit'
        WHEN 'withdrawal_lock' THEN 'withdrawal_pending'
        WHEN 'withdrawal_complete' THEN 'withdrawal'
        WHEN 'withdrawal_unlock' THEN 'withdrawal'
        WHEN 'withdrawal_refund' THEN 'withdrawal'
        WHEN 'fee_deduction' THEN 'fee'
        WHEN 'escrow_lock' THEN 'transfer'
        WHEN 'escrow_release' THEN 'transfer'
        WHEN 'escrow_refund' THEN 'transfer'
        WHEN 'internal_transfer_debit' THEN 'transfer'
        WHEN 'internal_transfer_credit' THEN 'transfer'
        WHEN 'admin_adjustment' THEN 'transfer'
        ELSE NULL
    END;

    IF v_legacy_type IS NULL THEN
        RAISE EXCEPTION 'Unsupported canonical ledger entry type for legacy compatibility: %', v_entry_type;
    END IF;

    IF v_row ? 'type' AND NULLIF(BTRIM(v_row->>'type'), '') IS NULL THEN
        v_patch := v_patch || jsonb_build_object('type', v_legacy_type);
    END IF;
    IF v_row ? 'amount' AND v_row->'amount' = 'null'::jsonb THEN
        v_patch := v_patch || jsonb_build_object('amount', v_amount);
    END IF;
    IF v_row ? 'crypto' AND NULLIF(BTRIM(v_row->>'crypto'), '') IS NULL THEN
        v_patch := v_patch || jsonb_build_object('crypto', v_asset);
    END IF;
    IF v_row ? 'asset' AND NULLIF(BTRIM(v_row->>'asset'), '') IS NULL THEN
        v_patch := v_patch || jsonb_build_object('asset', v_asset);
    END IF;
    IF v_row ? 'reference_id' AND NULLIF(BTRIM(v_row->>'reference_id'), '') IS NULL THEN
        v_patch := v_patch || jsonb_build_object('reference_id', NULLIF(BTRIM(v_row->>'ref_id'), ''));
    END IF;
    IF v_row ? 'balance_after' AND v_row->'balance_after' = 'null'::jsonb THEN
        v_patch := v_patch || jsonb_build_object(
            'balance_after', COALESCE(NULLIF(v_row->>'available_after', '')::numeric, 0)
        );
    END IF;
    IF v_row ? 'metadata' AND v_row->'metadata' = 'null'::jsonb THEN
        v_patch := v_patch || jsonb_build_object(
            'metadata',
            jsonb_build_object(
                'entry_type', v_entry_type,
                'ref_table', v_row->>'ref_table',
                'ref_id', v_row->>'ref_id',
                'delta_available', v_delta_available,
                'delta_locked', v_delta_locked
            )
        );
    END IF;

    NEW := jsonb_populate_record(NEW, v_patch);
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_ledger_entries_legacy_insert_columns ON public.ledger_entries;
CREATE TRIGGER trg_sync_ledger_entries_legacy_insert_columns
    BEFORE INSERT ON public.ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_ledger_entries_legacy_insert_columns();

COMMIT;