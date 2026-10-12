-- Track per-address UTXO chain history so scans can page through transactions
-- missed during worker downtime rather than relying on the API's first page.
BEGIN;

CREATE TABLE IF NOT EXISTS public.utxo_deposit_scan_cursors (
    network_code TEXT NOT NULL CHECK (network_code IN ('BTC', 'LTC')),
    address TEXT NOT NULL,
    last_seen_txid TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (network_code, address)
);

ALTER TABLE public.utxo_deposit_scan_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.utxo_deposit_scan_cursors FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.utxo_deposit_scan_cursors TO service_role;

COMMIT;
