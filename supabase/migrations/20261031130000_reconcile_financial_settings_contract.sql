-- Reconcile fee and withdrawal governance settings with the deployed key/value
-- app_settings table and single-row platform_settings table.
-- Defaults match the current server-side withdrawal and UI policy. Existing saved
-- values are preserved; this migration only fills missing settings.
BEGIN;

ALTER TABLE public.platform_settings
    ADD COLUMN IF NOT EXISTS withdrawal_approval_threshold_usd NUMERIC(18, 2) NOT NULL DEFAULT 2000.00;

ALTER TABLE public.platform_settings
    ADD COLUMN IF NOT EXISTS withdrawal_fee_multiplier NUMERIC(5, 2) NOT NULL DEFAULT 2.00;

ALTER TABLE public.platform_settings
    ALTER COLUMN max_single_withdrawal_usd SET DEFAULT 4000.00,
    ALTER COLUMN daily_withdrawal_limit_usd SET DEFAULT 10000.00,
    ALTER COLUMN withdrawal_approval_threshold_usd SET DEFAULT 2000.00,
    ALTER COLUMN withdrawal_fee_multiplier SET DEFAULT 2.00,
    ALTER COLUMN password_change_withdrawal_hold_hours SET DEFAULT 24.00;

-- The row is required by request_withdrawal and the admin governance page.
-- ON CONFLICT DO NOTHING preserves any existing live settings.
INSERT INTO public.platform_settings (
    id,
    withdrawals_enabled,
    global_kill_switch_active,
    max_single_withdrawal_usd,
    withdrawal_approval_threshold_usd,
    daily_withdrawal_limit_usd,
    password_change_withdrawal_hold_hours,
    withdrawal_fee_multiplier,
    updated_at
) VALUES (
    1,
    TRUE,
    FALSE,
    4000.00,
    2000.00,
    10000.00,
    24.00,
    2.00,
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- app_settings is keyed by text, not a synthetic id row. Store values as text
-- because that is the deployed schema's actual value type.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES
    ('platform_fee_percent', '1.5', NOW()),
    ('escrow_fee_percent', '1.5', NOW()),
    ('min_trade_amount', '10', NOW())
ON CONFLICT (key) DO NOTHING;

COMMIT;
