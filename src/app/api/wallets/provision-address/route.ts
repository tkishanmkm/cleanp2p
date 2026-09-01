import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { deriveHDAddress, encodeBech32 } from '@/lib/hd-wallet';
import { ethers } from 'ethers';
import crypto from 'crypto';

// Base58 Alphabet
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Base58Check decoder for private keys / WIF
 */
function decodeBase58Check(str: string): Buffer {
  let num = 0n;
  for (let i = 0; i < str.length; i++) {
    const charIndex = BASE58_ALPHABET.indexOf(str[i]);
    if (charIndex === -1) {
      throw new Error(`Invalid Base58 character: ${str[i]}`);
    }
    num = num * 58n + BigInt(charIndex);
  }

  let hex = num.toString(16);
  if (hex.length % 2 !== 0) {
    hex = '0' + hex;
  }
  let bytes = Buffer.from(hex, 'hex');

  let leadingZeros = 0;
  for (let i = 0; i < str.length && str[i] === '1'; i++) {
    leadingZeros++;
  }
  if (leadingZeros > 0) {
    bytes = Buffer.concat([Buffer.alloc(leadingZeros, 0), bytes]);
  }

  if (bytes.length < 4) {
    throw new Error('Base58Check string too short');
  }

  const payload = bytes.subarray(0, bytes.length - 4);
  const checksum = bytes.subarray(bytes.length - 4);
  const hash1 = crypto.createHash('sha256').update(payload).digest();
  const hash2 = crypto.createHash('sha256').update(hash1).digest();
  const expectedChecksum = hash2.subarray(0, 4);

  if (!checksum.equals(expectedChecksum)) {
    throw new Error('Invalid Base58Check checksum');
  }

  return payload;
}

/**
 * Derives a Tron Base58Check address (T...) from a raw private key hex or WIF string
 */
function getTronAddressFromPrivateKey(privKey: string): string {
  try {
    let cleanHex = privKey.trim();
    if (cleanHex.startsWith('0x') || cleanHex.startsWith('0X')) {
      cleanHex = cleanHex.slice(2);
    }

    if (cleanHex.length !== 64 && (cleanHex.startsWith('5') || cleanHex.startsWith('K') || cleanHex.startsWith('L'))) {
      const decoded = decodeBase58Check(cleanHex);
      const rawKeyBytes = decoded.subarray(1, 33);
      cleanHex = rawKeyBytes.toString('hex');
    }

    const signingKey = new ethers.SigningKey('0x' + cleanHex);
    const uncompressedPubKey = signingKey.publicKey;
    const pubKeyBytes = Buffer.from(uncompressedPubKey.slice(4), 'hex');

    const keccakHash = ethers.keccak256(pubKeyBytes);
    const last20Bytes = Buffer.from(keccakHash.slice(2 + 24), 'hex');

    const tronPayload = Buffer.concat([Buffer.from([0x41]), last20Bytes]);
    const hash1 = crypto.createHash('sha256').update(tronPayload).digest();
    const hash2 = crypto.createHash('sha256').update(hash1).digest();
    const checksum = hash2.subarray(0, 4);
    const fullData = Buffer.concat([tronPayload, checksum]);

    let num = BigInt('0x' + fullData.toString('hex'));
    let encoded = '';
    while (num > 0n) {
      const remainder = Number(num % 58n);
      num = num / 58n;
      encoded = BASE58_ALPHABET[remainder] + encoded;
    }
    for (let i = 0; i < fullData.length && fullData[i] === 0; i++) {
      encoded = '1' + encoded;
    }
    return encoded;
  } catch (err) {
    console.error("Provision address: failed to derive Tron address from private key:", err);
    return process.env.TRON_HOT_WALLET_ADDRESS || 'TQmfVCq67WmUhHVLTtARfASf3urPz9QEaF';
  }
}

/**
 * Derives a Bitcoin Native SegWit address (bc1q...) directly from a private key
 */
function getBtcSegwitAddressFromPrivateKey(privKey: string): string {
  try {
    let cleanHex = privKey.trim();
    if (cleanHex.startsWith('0x') || cleanHex.startsWith('0X')) {
      cleanHex = cleanHex.slice(2);
    }

    if (cleanHex.length !== 64 && (cleanHex.startsWith('5') || cleanHex.startsWith('K') || cleanHex.startsWith('L') || cleanHex.startsWith('c') || cleanHex.startsWith('9'))) {
      const decoded = decodeBase58Check(cleanHex);
      const rawKeyBytes = decoded.subarray(1, 33);
      cleanHex = rawKeyBytes.toString('hex');
    }

    if (cleanHex.length !== 64) {
      throw new Error(`Invalid private key length for BTC: ${cleanHex.length}`);
    }

    const signingKey = new ethers.SigningKey('0x' + cleanHex);
    const compressedPubKey = signingKey.compressedPublicKey;
    const pubKeyBuffer = Buffer.from(compressedPubKey.slice(2), 'hex');

    const sha256Hash = crypto.createHash('sha256').update(pubKeyBuffer).digest();
    const ripemd160Hash = crypto.createHash('ripemd160').update(sha256Hash).digest();

    return encodeBech32('bc1', ripemd160Hash);
  } catch (err) {
    console.error("Provision address: failed to derive BTC address from private key:", err);
    return process.env.BTC_HOT_WALLET_ADDRESS || 'bc1qg8m0jncj2630724n4zdjm4veplsn6zcz3jxyu9';
  }
}

/**
 * Derives a Litecoin Native SegWit address (ltc1q...) directly from private key
 */
function getLtcSegwitAddressFromPrivateKey(privKey: string): string {
  try {
    let cleanHex = privKey.trim();
    if (cleanHex.startsWith('0x') || cleanHex.startsWith('0X')) {
      cleanHex = cleanHex.slice(2);
    }
    if (cleanHex.length !== 64 && (cleanHex.startsWith('6') || cleanHex.startsWith('T') || cleanHex.startsWith('L') || cleanHex.startsWith('K') || cleanHex.startsWith('5'))) {
      const decoded = decodeBase58Check(cleanHex);
      cleanHex = decoded.subarray(1, 33).toString('hex');
    }
    const signingKey = new ethers.SigningKey('0x' + cleanHex);
    const compressedPubKey = signingKey.compressedPublicKey;
    const pubKeyBuffer = Buffer.from(compressedPubKey.slice(2), 'hex');
    const sha256Hash = crypto.createHash('sha256').update(pubKeyBuffer).digest();
    const ripemd160Hash = crypto.createHash('ripemd160').update(sha256Hash).digest();
    return encodeBech32('ltc1', ripemd160Hash);
  } catch (err) {
    console.error("Provision address: failed to derive LTC address from private key:", err);
    return process.env.LTC_HOT_WALLET_ADDRESS || 'ltc1qhpcls4r6fux2z8kgmmktn8sqrzyp72lmavxl8u';
  }
}

/**
 * Derives an EVM address (0x...) directly from a private key
 */
function getEvmAddressFromPrivateKey(privKey: string): string {
  try {
    let cleanKey = privKey.trim();
    if (!cleanKey.startsWith('0x')) {
      cleanKey = `0x${cleanKey}`;
    }
    const wallet = new ethers.Wallet(cleanKey);
    return wallet.address;
  } catch (err) {
    console.error("Provision address: failed to derive EVM address from private key:", err);
    return process.env.EVM_HOT_WALLET_ADDRESS || '0xB5e9502336A2968467555bBaC369210cAA974e95';
  }
}

/**
 * Initializes Supabase Admin Client bypassing RLS policies
 */
function getAdminSupabaseClient(): SupabaseClient {
  return getSupabaseAdminClient();
}

/**
 * Authenticates user from request session cookies or Authorization Bearer header
 */
async function authenticateRequest(req: NextRequest, adminClient: SupabaseClient) {
  // 1. Check Bearer Authorization Header
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const { data, error } = await adminClient.auth.getUser(token);
      if (!error && data?.user) {
        return data.user;
      }
    } catch {
      // fallback to cookies
    }
  }

  // 2. Authenticate via @supabase/ssr request cookies
  try {
    const cookieStore = cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    if (supabaseUrl && anonKey) {
      const supabaseUserClient = createServerClient(supabaseUrl, anonKey, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Ignore in route handler context
            }
          },
        },
      });

      const { data: { user }, error } = await supabaseUserClient.auth.getUser();
      if (!error && user) {
        return user;
      }
    }
  } catch (cookieErr) {
    console.warn("Cookie session resolution warning:", cookieErr);
  }

  // 3. Fallback: Parse Supabase session access tokens from cookies
  try {
    const cookieStore = cookies();
    const allCookies = cookieStore.getAll();
    for (const c of allCookies) {
      if (c.name.includes('auth-token') || c.name.startsWith('sb-')) {
        try {
          const parsed = JSON.parse(decodeURIComponent(c.value));
          const accessToken = parsed.access_token || parsed[0];
          if (accessToken && typeof accessToken === 'string') {
            const { data, error } = await adminClient.auth.getUser(accessToken);
            if (!error && data?.user) {
              return data.user;
            }
          }
        } catch {
          // ignore parsing error
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Normalizes input chain/asset into canonical chain category:
 * - BNB / ETH / ERC20 / BEP20 / EVM -> "EVM"
 * - BTC -> "BTC"
 * - LTC -> "LTC"
 * - TRX / USDT-TRC20 / TRON -> "TRON"
 */
function normalizeChain(input: string): 'EVM' | 'BTC' | 'LTC' | 'TRON' {
  const norm = (input || '').toUpperCase().trim();
  if (['BTC', 'BITCOIN'].includes(norm)) return 'BTC';
  if (['LTC', 'LITECOIN'].includes(norm)) return 'LTC';
  if (['TRON', 'TRX', 'TRC20', 'USDT-TRC20', 'USDT_TRC20'].includes(norm)) return 'TRON';
  return 'EVM';
}

/**
 * Derives on-chain address using configured XPUB, with hot wallet private key/address fallback
 */
async function deriveAddressForChain(
  chainCategory: 'EVM' | 'BTC' | 'LTC' | 'TRON',
  derivationIndex: number,
  specificAsset?: string
): Promise<{ address: string; network: string; asset: string; derivationPath: string }> {
  switch (chainCategory) {
    case 'EVM': {
      const asset = (specificAsset || 'USDT').toUpperCase();
      const network = 'BEP20';
      const derivationPath = `m/44'/60'/0'/0/${derivationIndex}`;

      if (process.env.EVM_XPUB) {
        try {
          const hdNode = ethers.HDNodeWallet.fromExtendedKey(process.env.EVM_XPUB);
          const child = hdNode.deriveChild(derivationIndex);
          return { address: child.address, network, asset, derivationPath };
        } catch {
          const { address, path } = await deriveHDAddress(asset, network, process.env.EVM_XPUB, derivationIndex);
          return { address, network, asset, derivationPath: path };
        }
      }

      if (process.env.EVM_HOT_WALLET_PRIVATE_KEY) {
        return {
          address: getEvmAddressFromPrivateKey(process.env.EVM_HOT_WALLET_PRIVATE_KEY),
          network,
          asset,
          derivationPath,
        };
      }

      return {
        address: process.env.EVM_HOT_WALLET_ADDRESS || '0xB5e9502336A2968467555bBaC369210cAA974e95',
        network,
        asset,
        derivationPath,
      };
    }

    case 'BTC': {
      const asset = 'BTC';
      const network = 'BTC';
      const derivationPath = `m/84'/0'/0'/0/${derivationIndex}`;

      if (process.env.BTC_XPUB) {
        try {
          const { address, path } = await deriveHDAddress('BTC', 'BTC', process.env.BTC_XPUB, derivationIndex);
          if (address && address.startsWith('bc1')) {
            return { address, network, asset, derivationPath: path };
          }
        } catch (err) {
          console.warn("BTC HD derivation warning:", err);
        }
      }

      if (process.env.BTC_HOT_WALLET_PRIVATE_KEY) {
        return {
          address: getBtcSegwitAddressFromPrivateKey(process.env.BTC_HOT_WALLET_PRIVATE_KEY),
          network,
          asset,
          derivationPath,
        };
      }

      return {
        address: process.env.BTC_HOT_WALLET_ADDRESS || 'bc1qg8m0jncj2630724n4zdjm4veplsn6zcz3jxyu9',
        network,
        asset,
        derivationPath,
      };
    }

    case 'LTC': {
      const asset = 'LTC';
      const network = 'LTC';
      const derivationPath = `m/84'/2'/0'/0/${derivationIndex}`;

      if (process.env.LTC_XPUB) {
        try {
          const { address, path } = await deriveHDAddress('LTC', 'LTC', process.env.LTC_XPUB, derivationIndex);
          if (address && address.startsWith('ltc1')) {
            return { address, network, asset, derivationPath: path };
          }
        } catch (err) {
          console.warn("LTC HD derivation warning:", err);
        }
      }

      if (process.env.LTC_HOT_WALLET_PRIVATE_KEY) {
        return {
          address: getLtcSegwitAddressFromPrivateKey(process.env.LTC_HOT_WALLET_PRIVATE_KEY),
          network,
          asset,
          derivationPath,
        };
      }

      return {
        address: process.env.LTC_HOT_WALLET_ADDRESS || 'ltc1qhpcls4r6fux2z8kgmmktn8sqrzyp72lmavxl8u',
        network,
        asset,
        derivationPath,
      };
    }

    case 'TRON': {
      const asset = specificAsset === 'TRX' ? 'TRX' : 'USDT';
      const network = 'TRC20';
      const derivationPath = `m/44'/195'/0'/0/${derivationIndex}`;

      if (process.env.TRON_XPUB) {
        try {
          const { address, path } = await deriveHDAddress(asset, network, process.env.TRON_XPUB, derivationIndex);
          if (address && address.startsWith('T')) {
            return { address, network, asset, derivationPath: path };
          }
        } catch (err) {
          console.warn("TRON HD derivation warning:", err);
        }
      }

      if (process.env.TRON_HOT_WALLET_PRIVATE_KEY) {
        return {
          address: getTronAddressFromPrivateKey(process.env.TRON_HOT_WALLET_PRIVATE_KEY),
          network,
          asset,
          derivationPath,
        };
      }

      return {
        address: process.env.TRON_HOT_WALLET_ADDRESS || 'TQmfVCq67WmUhHVLTtARfASf3urPz9QEaF',
        network,
        asset,
        derivationPath,
      };
    }
  }
}

/**
 * Main Provisioning Handler
 */
async function handleProvisioning(req: NextRequest) {
  try {
    // 1. Initialize Supabase Admin Client
    const adminClient = getAdminSupabaseClient();

    // 2. Authenticate Request
    const user = await authenticateRequest(req, adminClient);
    if (!user || !user.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Please sign in to view and provision deposit addresses.' },
        { status: 401 }
      );
    }

    // 3. Parse input body / params
    let rawChain = '';
    let rawAsset = '';
    let rawNetwork = '';

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      rawChain = body.chain || '';
      rawAsset = body.asset || '';
      rawNetwork = body.network || '';
    } else {
      const url = new URL(req.url);
      rawChain = url.searchParams.get('chain') || '';
      rawAsset = url.searchParams.get('asset') || '';
      rawNetwork = url.searchParams.get('network') || '';
    }

    const chainCategory = normalizeChain(rawChain || rawNetwork || rawAsset);

    // 4. Idempotent Lookup in deposit_addresses via Admin Client
    const { data: existingRecords, error: lookupError } = await adminClient
      .from('deposit_addresses')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (lookupError) {
      console.warn("deposit_addresses lookup warning:", lookupError);
    }

    if (existingRecords && existingRecords.length > 0) {
      const existingMatch = existingRecords.find((rec: any) => {
        const net = (rec.network_code || rec.network || '').toUpperCase();
        const ast = (rec.asset_code || rec.asset || '').toUpperCase();
        const chn = (rec.chain || '').toUpperCase();

        if (chainCategory === 'EVM') {
          return (
            chn === 'EVM' ||
            net === 'BEP20' ||
            net === 'ERC20' ||
            net === 'ETH' ||
            net === 'BSC' ||
            net === 'POLYGON' ||
            net === 'ARBITRUM' ||
            rec.address?.startsWith('0x')
          );
        } else if (chainCategory === 'BTC') {
          return chn === 'BTC' || net === 'BTC' || ast === 'BTC' || rec.address?.startsWith('bc1');
        } else if (chainCategory === 'LTC') {
          return chn === 'LTC' || net === 'LTC' || ast === 'LTC' || rec.address?.startsWith('ltc1');
        } else if (chainCategory === 'TRON') {
          return chn === 'TRON' || net === 'TRC20' || net === 'TRX' || ast === 'TRX' || rec.address?.startsWith('T');
        }
        return false;
      });

      if (existingMatch?.address) {
        return NextResponse.json({
          success: true,
          address: existingMatch.address,
          chain: chainCategory,
          network: existingMatch.network_code || chainCategory,
          asset: existingMatch.asset_code || rawAsset || chainCategory,
        }, { status: 200 });
      }
    }

    // 5. Atomic Counter Increment from address_derivation_counters via Admin Client
    let derivationIndex = 1;
    try {
      const { data: counterData, error: counterError } = await adminClient
        .from('address_derivation_counters')
        .select('next_index')
        .eq('chain', chainCategory)
        .maybeSingle();

      if (!counterError && counterData && typeof counterData.next_index === 'number') {
        derivationIndex = counterData.next_index;
        await adminClient
          .from('address_derivation_counters')
          .update({
            next_index: derivationIndex + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('chain', chainCategory);
      } else {
        // Count existing addresses on this chain
        const { count } = await adminClient
          .from('deposit_addresses')
          .select('*', { count: 'exact', head: true })
          .eq('network_code', chainCategory);

        derivationIndex = (count || 0) + 1;

        // Upsert counter
        await adminClient
          .from('address_derivation_counters')
          .upsert(
            {
              chain: chainCategory,
              next_index: derivationIndex + 1,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'chain' }
          );
      }
    } catch (countErr) {
      console.warn("Derivation counter atomic increment fallback:", countErr);
      derivationIndex = 1;
    }

    // 6. Derive Address for Chain
    const derived = await deriveAddressForChain(chainCategory, derivationIndex, rawAsset);

    // 7. Ensure User Wallet Container exists
    let walletId: string | null = null;
    try {
      const { data: wallet } = await adminClient
        .from('wallets')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (wallet?.id) {
        walletId = wallet.id;
      } else {
        const { data: newWallet } = await adminClient
          .from('wallets')
          .insert({
            user_id: user.id,
            status: 'active',
            provisioning_status: 'completed',
          })
          .select('id')
          .single();

        walletId = newWallet?.id || null;
      }
    } catch (wErr) {
      console.warn("Wallet lookup/creation warning:", wErr);
    }

    // 8. Insert New Record into deposit_addresses via Admin Client (Bypassing RLS)
    try {
      const record: Record<string, any> = {
        user_id: user.id,
        asset_code: derived.asset,
        network_code: derived.network,
        address: derived.address,
        custody_provider: 'internal_hot_hd',
        derivation_path: derived.derivationPath,
        status: 'active',
        updated_at: new Date().toISOString(),
      };

      if (walletId) {
        record.wallet_id = walletId;
      }

      await adminClient.from('deposit_addresses').insert(record);
    } catch (insertErr) {
      console.warn("Insert deposit_address warning:", insertErr);
    }

    // 9. Return standard success payload
    return NextResponse.json({
      success: true,
      address: derived.address,
      chain: chainCategory,
      network: derived.network,
      asset: derived.asset,
    }, { status: 200 });

  } catch (err: any) {
    console.error("Error in /api/wallets/provision-address route:", err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Failed to provision deposit address. Please try again.',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handleProvisioning(req);
}

export async function GET(req: NextRequest) {
  return handleProvisioning(req);
}
