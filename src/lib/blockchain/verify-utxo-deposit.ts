export type UtxoNetwork = 'BTC' | 'LTC';

export interface VerifiedUtxoOutput {
  txid: string;
  address: string;
  outputIndex: number;
  amount: string;
  confirmations: number;
  blockHeight: number | null;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function formatSatoshis(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid UTXO base-unit amount.');
  const amount = BigInt(value);
  const whole = amount / 100_000_000n;
  const fraction = (amount % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

function apiBase(network: UtxoNetwork): string {
  const configured = network === 'BTC'
    ? process.env.BTC_MEMPOOL_API
    : process.env.LTC_MEMPOOL_API;
  const fallback = network === 'BTC'
    ? 'https://mempool.space/api'
    : 'https://litecoinspace.org/api';
  const base = (configured || fallback).trim().replace(/\/+$/, '');
  // Prevent a configuration typo from silently verifying on the wrong chain.
  const url = new URL(base);
  if (url.protocol !== 'https:') throw new Error('Explorer endpoint must use HTTPS');
  return base;
}

/**
 * Verify all credit-bearing UTXO fields against a public chain explorer.
 * Caller-supplied amount, confirmation count and network metadata are never trusted.
 * Returns null for a missing/mismatched output, unconfirmed transaction, or invalid response.
 */
export async function verifyUtxoDepositOutput(
  network: UtxoNetwork,
  txid: string,
  address: string,
  outputIndex: number,
  fetcher: FetchLike = fetch,
): Promise<VerifiedUtxoOutput | null> {
  if (!/^[a-fA-F0-9]{64}$/.test(txid) || !address.trim() ||
      !Number.isSafeInteger(outputIndex) || outputIndex < 0) return null;

  const base = apiBase(network);
  const txResponse = await fetcher(`${base}/tx/${encodeURIComponent(txid)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!txResponse.ok) return null;
  const tx: any = await txResponse.json();
  if (typeof tx?.txid !== 'string' || tx.txid.toLowerCase() !== txid.toLowerCase() ||
      !Array.isArray(tx.vout) || !tx.status?.confirmed ||
      !Number.isSafeInteger(tx.status.block_height) || tx.status.block_height <= 0) return null;

  const output = tx.vout[outputIndex];
  if (!output || output.scriptpubkey_address !== address ||
      !Number.isSafeInteger(output.value) || output.value <= 0) return null;

  const tipResponse = await fetcher(`${base}/blocks/tip/height`, {
    headers: { accept: 'text/plain' },
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!tipResponse.ok) return null;
  const tipText = (await tipResponse.text()).trim();
  if (!/^\d+$/.test(tipText)) return null;
  const tip = Number(tipText);
  const confirmations = tip >= tx.status.block_height ? tip - tx.status.block_height + 1 : 0;
  if (!Number.isSafeInteger(tip) || confirmations < 1) return null;

  return {
    txid: tx.txid,
    address,
    outputIndex,
    amount: formatSatoshis(output.value),
    confirmations,
    blockHeight: tx.status.block_height,
  };
}
