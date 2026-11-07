import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyUtxoDepositOutput } from '../src/lib/blockchain/verify-utxo-deposit';

const txid = 'a'.repeat(64);
const address = 'bc1qsyntheticaddress';
function mockFetch(options: {
  confirmed?: boolean;
  txid?: string;
  address?: string;
  value?: number;
  height?: number;
  tip?: number;
  blockHash?: string;
  canonicalBlockHash?: string;
} = {}) {
  const calls: string[] = [];
  const defaultBlockHash = 'c'.repeat(64);
  const fetcher = async (input: string | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/blocks/tip/height')) {
      return new Response(String(options.tip ?? 120), { status: 200 });
    }
    if (url.endsWith('/block-height/100')) {
      return new Response(options.canonicalBlockHash ?? options.blockHash ?? defaultBlockHash, { status: 200 });
    }
    return Response.json({
      txid: options.txid ?? txid,
      status: {
        confirmed: options.confirmed ?? true,
        block_height: options.height ?? 100,
        block_hash: options.blockHash ?? defaultBlockHash,
      },
      vout: [{ scriptpubkey_address: options.address ?? address, value: options.value ?? 250_000_000 }],
    });
  };
  return { fetcher, calls };
}

test('verifies chain-derived address, output amount, block and confirmations', async () => {
  const { fetcher, calls } = mockFetch();
  const result = await verifyUtxoDepositOutput('BTC', txid, address, 0, fetcher);
  assert.deepEqual(result, { txid, address, outputIndex: 0, amount: 2.5, confirmations: 21, blockHeight: 100 });
  assert.match(calls[0], /^https:\/\/mempool\.space\/api\/tx\//);
});

test('rejects unconfirmed transactions even when caller claims confirmations', async () => {
  const { fetcher } = mockFetch({ confirmed: false });
  assert.equal(await verifyUtxoDepositOutput('BTC', txid, address, 0, fetcher), null);
});

test('rejects a destination address mismatch', async () => {
  const { fetcher } = mockFetch({ address: 'bc1qdifferent' });
  assert.equal(await verifyUtxoDepositOutput('BTC', txid, address, 0, fetcher), null);
});

test('rejects a transaction identity mismatch (wrong-chain or forged event)', async () => {
  const { fetcher } = mockFetch({ txid: 'b'.repeat(64) });
  assert.equal(await verifyUtxoDepositOutput('BTC', txid, address, 0, fetcher), null);
});

test('rejects a transaction whose block is no longer canonical at its height', async () => {
  const { fetcher } = mockFetch({ blockHash: 'c'.repeat(64), canonicalBlockHash: 'd'.repeat(64) });
  assert.equal(await verifyUtxoDepositOutput('BTC', txid, address, 0, fetcher), null);
});

test('uses Litecoin mainnet explorer for LTC verification', async () => {
  const { fetcher, calls } = mockFetch();
  await verifyUtxoDepositOutput('LTC', txid, address, 0, fetcher);
  assert.match(calls[0], /^https:\/\/litecoinspace\.org\/api\/tx\//);
});

test('rejects malformed transaction ids and invalid output indices without network calls', async () => {
  let called = false;
  const fetcher = async (): Promise<Response> => { called = true; return new Response('', { status: 500 }); };
  assert.equal(await verifyUtxoDepositOutput('BTC', 'not-a-txid', address, 0, fetcher), null);
  assert.equal(await verifyUtxoDepositOutput('BTC', txid, address, -1, fetcher), null);
  assert.equal(called, false);
});
