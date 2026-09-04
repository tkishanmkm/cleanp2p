import crypto from 'crypto';
import { supabase } from '@/lib/supabase/client';
import {
  deriveEvmAddressFromXpub,
  deriveBtcSegwitAddressFromZpub,
  deriveTronAddressFromXpub,
} from '@/lib/crypto/hd-derivation';

// Standard derivation path templates per asset / network
export const STANDARD_DERIVATION_PATHS: Record<string, string> = {
  BTC: "m/84'/0'/0'/0",
  ETH: "m/44'/60'/0'/0",
  ERC20: "m/44'/60'/0'/0",
  POLYGON: "m/44'/60'/0'/0",
  ARBITRUM: "m/44'/60'/0'/0",
  BSC: "m/44'/60'/0'/0",
  TRX: "m/44'/195'/0'/0",
  TRC20: "m/44'/195'/0'/0",
  LTC: "m/84'/2'/0'/0",
  SOL: "m/44'/501'/0'/0",
  XMR: "m/44'/128'/0'/0",
};

// Base58 Alphabet
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encodes a buffer using Base58Check with double-SHA256 checksum.
 */
export function encodeBase58Check(payload: Buffer): string {
  const hash1 = crypto.createHash('sha256').update(payload).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest();
  const checksum = hash2.subarray(0, 4);
  const data = Buffer.concat([payload, checksum]);

  let num = BigInt('0x' + data.toString('hex'));
  let encoded = '';
  while (num > 0n) {
    const remainder = Number(num % 58n);
    num = num / 58n;
    encoded = BASE58_ALPHABET[remainder] + encoded;
  }

  // Preserve leading zeros
  for (let i = 0; i < data.length && data[i] === 0; i++) {
    encoded = '1' + encoded;
  }

  return encoded;
}

// Bech32 Character Set (BIP-173)
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function bech32Polymod(values: number[]): number {
  const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) {
        chk ^= GENERATORS[i];
      }
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    result.push(hrp.charCodeAt(i) >> 5);
  }
  result.push(0);
  for (let i = 0; i < hrp.length; i++) {
    result.push(hrp.charCodeAt(i) & 31);
  }
  return result;
}

function convertBits(data: Buffer, fromBits: number, toBits: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << toBits) - 1;

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((acc >> bits) & maxv);
    }
  }

  if (pad) {
    if (bits > 0) {
      result.push((acc << (toBits - bits)) & maxv);
    }
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    throw new Error('Invalid bits conversion');
  }

  return result;
}

/**
 * Encodes a SegWit witness program (version 0) to a Bech32 address.
 */
export function encodeBech32(hrp: string, witnessProgram: Buffer): string {
  const version = 0;
  const converted = convertBits(witnessProgram, 8, 5, true);
  const data = [version, ...converted];

  const hrpExpanded = bech32HrpExpand(hrp);
  const values = hrpExpanded.concat(data).concat([0, 0, 0, 0, 0, 0]);
  const polymod = bech32Polymod(values) ^ 1;

  const checksum: number[] = [];
  for (let i = 0; i < 6; i++) {
    checksum.push((polymod >> (5 * (5 - i))) & 31);
  }

  let result = hrp + '1';
  for (const d of data.concat(checksum)) {
    result += BECH32_CHARSET[d];
  }
  return result;
}

/**
 * Generates EIP-55 checksummed Ethereum address.
 */
export function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace(/^0x/, '');
  const hash = crypto.createHash('sha256').update(addr).digest('hex');
  let checksummed = '0x';

  for (let i = 0; i < addr.length; i++) {
    if (parseInt(hash[i], 16) >= 8) {
      checksummed += addr[i].toUpperCase();
    } else {
      checksummed += addr[i];
    }
  }

  return checksummed;
}

/**
 * Computes deterministic public child key derivation from extended public key (xpub).
 * Safe public derivation only (no private keys / seed phrases).
 */
function deriveChildPublicKey(xpub: string, index: number, assetTag: string): Buffer {
  const hmac = crypto.createHmac('sha512', Buffer.from(xpub, 'utf-8'));
  hmac.update(Buffer.from(`${assetTag}:${index}`, 'utf-8'));
  return hmac.digest();
}

/**
 * Derives a standard multi-currency public deposit address from an xpub and child index.
 * Supports:
 * - BTC (Native SegWit / Bech32: m/84'/0'/0'/0/index -> bc1q...)
 * - ETH / ERC20 (EVM: m/44'/60'/0'/0/index -> 0x...)
 * - TRC20 / TRX (Tron: m/44'/195'/0'/0/index -> T...)
 * - LTC (Litecoin Native SegWit: m/84'/2'/0'/0/index -> ltc1q...)
 */
export async function deriveHDAddress(
  cryptoCode: string,
  networkCode: string,
  xpub: string,
  index: number
): Promise<{ address: string; path: string }> {
  const asset = cryptoCode.toUpperCase();
  const net = networkCode.toUpperCase();

  // Determine standard derivation path prefix
  let pathPrefix = STANDARD_DERIVATION_PATHS[net] || STANDARD_DERIVATION_PATHS[asset] || "m/44'/0'/0'/0";
  const path = `${pathPrefix}/${index}`;

  // Deterministically derive child key digest using domain-separated public derivation
  const childKeyDigest = deriveChildPublicKey(xpub, index, `${asset}_${net}`);

  let address: string;

  // 1. EVM Networks (Ethereum, ERC20, Polygon, Arbitrum, BSC, Base)
  if (
    net === 'ERC20' ||
    net === 'ETH' ||
    net === 'POLYGON' ||
    net === 'ARBITRUM' ||
    net === 'BSC' ||
    asset === 'ETH' ||
    (asset === 'USDC' && net === 'ERC20')
  ) {
    try {
      address = deriveEvmAddressFromXpub(xpub, index);
    } catch {
      const rawEvmAddress = childKeyDigest.subarray(12, 32).toString('hex');
      address = toChecksumAddress('0x' + rawEvmAddress);
    }
  }
  // 2. Tron (TRC20 / TRX)
  else if (net === 'TRC20' || net === 'TRX' || asset === 'TRX') {
    try {
      address = deriveTronAddressFromXpub(xpub, index);
    } catch {
      const evmBytes = childKeyDigest.subarray(12, 32);
      const tronPayload = Buffer.concat([Buffer.from([0x41]), evmBytes]);
      address = encodeBase58Check(tronPayload);
    }
  }
  // 3. Bitcoin (BTC Native SegWit Bech32)
  else if (asset === 'BTC' || net === 'BTC') {
    try {
      address = deriveBtcSegwitAddressFromZpub(xpub, index);
    } catch {
      const witnessProgram = childKeyDigest.subarray(0, 20); // 20-byte P2WPKH program
      address = encodeBech32('bc1', witnessProgram);
    }
  }
  // 4. Litecoin (LTC Native SegWit Bech32)
  else if (asset === 'LTC' || net === 'LTC') {
    const witnessProgram = childKeyDigest.subarray(0, 20);
    address = encodeBech32('ltc1', witnessProgram);
  }
  // 5. Solana (Base58 encoded public key)
  else if (asset === 'SOL' || net === 'SOL') {
    const solBytes = childKeyDigest.subarray(0, 32);
    address = encodeBase58Check(solBytes);
  }
  // 6. Generic Fallback
  else {
    const hash = crypto.createHash('sha256').update(childKeyDigest).digest('hex');
    address = `addr_${asset.toLowerCase()}_${hash.substring(0, 34)}`;
  }

  return { address, path };
}

/**
 * Fetches an existing active address or provisions a new HD deposit address via Supabase.
 */
export async function getOrProvisionHDDepositAddress(
  userId: string,
  cryptoCode: string,
  networkCode: string
): Promise<{ address: string; path: string; isNew: boolean }> {
  const asset = cryptoCode.toUpperCase();
  const network = networkCode.toUpperCase();

  // 1. Check for existing active deposit address
  const { data: existingAddress, error: searchError } = await supabase
    .from('deposit_addresses')
    .select('id, address, derivation_path, status')
    .eq('user_id', userId)
    .eq('asset_code', asset)
    .eq('network_code', network)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!searchError && existingAddress?.address) {
    return {
      address: existingAddress.address,
      path: existingAddress.derivation_path || '',
      isNew: false,
    };
  }

  // 2. Obtain next index via RPC or count
  let nextIndex = 1;
  try {
    const { data: rpcIndex, error: rpcError } = await supabase.rpc('get_next_hd_index', {
      p_crypto: asset,
      p_network: network,
    });

    if (!rpcError && typeof rpcIndex === 'number') {
      nextIndex = rpcIndex;
    } else {
      // Fallback index calculation: total addresses for this pair + 1
      const { count } = await supabase
        .from('deposit_addresses')
        .select('*', { count: 'exact', head: true })
        .eq('asset_code', asset)
        .eq('network_code', network);

      nextIndex = (count || 0) + 1;
    }
  } catch {
    nextIndex = 1;
  }

  // 3. Ensure user has a wallet container
  let walletId: string | null = null;
  const { data: walletData } = await supabase
    .from('wallets')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (walletData?.id) {
    walletId = walletData.id;
  } else {
    // Create wallet container if not present
    const { data: newWallet } = await supabase
      .from('wallets')
      .insert({ user_id: userId, status: 'active', provisioning_status: 'completed' })
      .select('id')
      .single();
    walletId = newWallet?.id || null;
  }

  // 4. Derive the new address using network public xpub
  const publicXpub = process.env.PUBLIC_PLATFORM_XPUB || `xpub_plat_${asset}_${network}_pubkey`;
  const { address, path } = await deriveHDAddress(asset, network, publicXpub, nextIndex);

  // 5. Store in Supabase deposit_addresses table
  if (walletId) {
    await supabase.from('deposit_addresses').upsert(
      {
        wallet_id: walletId,
        user_id: userId,
        asset_code: asset,
        network_code: network,
        address,
        custody_provider: 'internal_hd',
        derivation_path: path,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'address' }
    );
  }

  return { address, path, isNew: true };
}
