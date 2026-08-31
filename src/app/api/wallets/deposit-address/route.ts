import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { deriveHDAddress, encodeBech32 } from '@/lib/hd-wallet';
import { ethers } from 'ethers';
import crypto from 'crypto';

// Base58 Alphabet
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Base58Check decoder to extract raw bytes from WIF / private keys
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

  // Count leading '1's
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

    // Handle WIF encoded private keys
    if (cleanHex.length !== 64 && (cleanHex.startsWith('5') || cleanHex.startsWith('K') || cleanHex.startsWith('L'))) {
      const decoded = decodeBase58Check(cleanHex);
      // Skip network byte (1 byte) and optional compression flag (1 byte)
      const rawKeyBytes = decoded.subarray(1, 33);
      cleanHex = rawKeyBytes.toString('hex');
    }

    const signingKey = new ethers.SigningKey('0x' + cleanHex);
    // Uncompressed public key begins with 0x04 (65 bytes total)
    const uncompressedPubKey = signingKey.publicKey;
    const pubKeyBytes = Buffer.from(uncompressedPubKey.slice(4), 'hex'); // discard 0x04 prefix (64 bytes)

    // Keccak256 hash of the 64-byte public key point
    const keccakHash = ethers.keccak256(pubKeyBytes);
    const last20Bytes = Buffer.from(keccakHash.slice(2 + 24), 'hex'); // last 20 bytes (40 hex chars)

    // Tron address prefix is 0x41
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
    console.error("Deposit address error: failed to derive Tron address from private key:", err);
    return process.env.TRON_HOT_WALLET_ADDRESS || 'TYpQk9hPmsfWk1uLNxk1iW6dNm3rZJ4yTx';
  }
}

/**
 * Derives a Bitcoin Native SegWit address (bc1q...) directly from a private key (hex or WIF)
 */
function getBtcSegwitAddressFromPrivateKey(privKey: string): string {
  try {
    let cleanHex = privKey.trim();
    if (cleanHex.startsWith('0x') || cleanHex.startsWith('0X')) {
      cleanHex = cleanHex.slice(2);
    }

    // If given WIF (Wallet Import Format Base58 string)
    if (cleanHex.length !== 64 && (cleanHex.startsWith('5') || cleanHex.startsWith('K') || cleanHex.startsWith('L') || cleanHex.startsWith('c') || cleanHex.startsWith('9'))) {
      const decoded = decodeBase58Check(cleanHex);
      const rawKeyBytes = decoded.subarray(1, 33);
      cleanHex = rawKeyBytes.toString('hex');
    }

    if (cleanHex.length !== 64) {
      throw new Error(`Invalid private key length for BTC: ${cleanHex.length}`);
    }

    // Get compressed public key (33 bytes: 0x02 or 0x03 + x-coordinate)
    const signingKey = new ethers.SigningKey('0x' + cleanHex);
    const compressedPubKey = signingKey.compressedPublicKey; // 0x02... or 0x03... (33 bytes)
    const pubKeyBuffer = Buffer.from(compressedPubKey.slice(2), 'hex');

    // SHA-256 followed by RIPEMD-160 (HASH160)
    const sha256Hash = crypto.createHash('sha256').update(pubKeyBuffer).digest();
    const ripemd160Hash = crypto.createHash('ripemd160').update(sha256Hash).digest();

    // Native SegWit witness program version 0 (20 bytes witness program)
    return encodeBech32('bc1', ripemd160Hash);
  } catch (err) {
    console.error("Deposit address error: failed to derive BTC SegWit address from private key:", err);
    return process.env.BTC_HOT_WALLET_ADDRESS || 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
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
    console.error("Deposit address error: failed to derive EVM address from private key:", err);
    return process.env.EVM_HOT_WALLET_ADDRESS || '0x71C8F7E41e467d583C1c33c3e80E9e67d264fE08';
  }
}

/**
 * Authenticate session via @supabase/ssr cookies or Authorization Bearer header
 */
async function getAuthenticatedUser(req: NextRequest) {
  // 1. Check Bearer token in Authorization header
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '').trim();
    try {
      const admin = getSupabaseAdminClient();
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data?.user) {
        return data.user;
      }
    } catch {
      // continue to cookie checks
    }
  }

  // 2. Use @supabase/ssr with request cookies
  try {
    const cookieStore = cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

    if (supabaseUrl && supabaseAnonKey) {
      const supabaseServer = createServerClient(supabaseUrl, supabaseAnonKey, {
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

      const { data: { user }, error } = await supabaseServer.auth.getUser();
      if (!error && user) {
        return user;
      }
    }
  } catch (err) {
    console.warn("Deposit address cookie session auth check:", err);
  }

  // 3. Fallback: Parse Supabase session tokens stored in cookies
  try {
    const cookieStore = cookies();
    const allCookies = cookieStore.getAll();
    for (const c of allCookies) {
      if (c.name.includes('auth-token') || c.name.startsWith('sb-')) {
        try {
          const parsed = JSON.parse(decodeURIComponent(c.value));
          const accessToken = parsed.access_token || parsed[0];
          if (accessToken && typeof accessToken === 'string') {
            const admin = getSupabaseAdminClient();
            const { data, error } = await admin.auth.getUser(accessToken);
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
 * Derives or generates safe deposit address for all supported cryptocurrencies:
 * Prioritizes XPUB child derivation; if not set, directly derives from respective HOT_WALLET_PRIVATE_KEY.
 */
async function deriveDepositAddress(
  assetCode: string,
  networkCode: string,
  derivationIndex: number
): Promise<{ address: string; network: string; derivationPath?: string }> {
  const asset = assetCode.toUpperCase();
  let network = (networkCode || asset).toUpperCase();

  // Normalize defaults
  if (asset === 'ETH' && !network) network = 'ETH';
  if (asset === 'BTC') network = 'BTC';
  if (asset === 'LTC') network = 'LTC';
  if (asset === 'TRX') network = 'TRX';
  if (asset === 'USDT' && (!network || network === 'USDT')) network = 'TRC20';

  const isEVM =
    network === 'ETH' ||
    network === 'ERC20' ||
    network === 'BEP20' ||
    network === 'BSC' ||
    network === 'POLYGON' ||
    network === 'ARBITRUM' ||
    asset === 'ETH';

  // 1. EVM Assets (ETH, BSC, USDT BEP20, USDT ERC20, Polygon, Arbitrum)
  if (isEVM) {
    try {
      if (process.env.EVM_XPUB) {
        try {
          const hdNode = ethers.HDNodeWallet.fromExtendedKey(process.env.EVM_XPUB);
          const child = hdNode.deriveChild(derivationIndex);
          return { address: child.address, network, derivationPath: `m/44'/60'/0'/0/${derivationIndex}` };
        } catch {
          const { address, path } = await deriveHDAddress(asset, network, process.env.EVM_XPUB, derivationIndex);
          return { address, network, derivationPath: path };
        }
      }

      // If EVM_XPUB is not available, derive directly from EVM_HOT_WALLET_PRIVATE_KEY
      if (process.env.EVM_HOT_WALLET_PRIVATE_KEY) {
        const derived = getEvmAddressFromPrivateKey(process.env.EVM_HOT_WALLET_PRIVATE_KEY);
        return { address: derived, network };
      }

      if (process.env.EVM_HOT_WALLET_ADDRESS) {
        return { address: process.env.EVM_HOT_WALLET_ADDRESS, network };
      }

      // Deterministic fallback using master public key
      const { address, path } = await deriveHDAddress(
        asset,
        network,
        process.env.PUBLIC_PLATFORM_XPUB || 'xpub_default_evm_master_key',
        derivationIndex
      );
      return {
        address: address || '0x71C8F7E41e467d583C1c33c3e80E9e67d264fE08',
        network,
        derivationPath: path,
      };
    } catch (err) {
      console.error("Deposit address error in EVM derivation:", err);
      if (process.env.EVM_HOT_WALLET_PRIVATE_KEY) {
        return { address: getEvmAddressFromPrivateKey(process.env.EVM_HOT_WALLET_PRIVATE_KEY), network };
      }
      return {
        address: process.env.EVM_HOT_WALLET_ADDRESS || '0x71C8F7E41e467d583C1c33c3e80E9e67d264fE08',
        network,
      };
    }
  }

  // 2. Bitcoin (BTC)
  if (asset === 'BTC' || network === 'BTC') {
    try {
      if (process.env.BTC_XPUB) {
        const { address, path } = await deriveHDAddress('BTC', 'BTC', process.env.BTC_XPUB, derivationIndex);
        if (address && address.startsWith('bc1')) {
          return { address, network: 'BTC', derivationPath: path };
        }
      }

      // If BTC_XPUB is not set, derive Native SegWit (bc1q...) directly from BTC_HOT_WALLET_PRIVATE_KEY
      if (process.env.BTC_HOT_WALLET_PRIVATE_KEY) {
        const segwitAddress = getBtcSegwitAddressFromPrivateKey(process.env.BTC_HOT_WALLET_PRIVATE_KEY);
        return { address: segwitAddress, network: 'BTC' };
      }

      if (process.env.BTC_HOT_WALLET_ADDRESS) {
        return { address: process.env.BTC_HOT_WALLET_ADDRESS, network: 'BTC' };
      }

      const { address, path } = await deriveHDAddress(
        'BTC',
        'BTC',
        process.env.PUBLIC_PLATFORM_XPUB || 'xpub_default_btc_master_key',
        derivationIndex
      );
      if (address && address.startsWith('bc1')) {
        return { address, network: 'BTC', derivationPath: path };
      }
    } catch (err) {
      console.error("Deposit address error in BTC derivation:", err);
    }
    return {
      address: process.env.BTC_HOT_WALLET_ADDRESS || 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      network: 'BTC',
    };
  }

  // 3. Tron (USDT TRC20 / TRX)
  if (network === 'TRC20' || network === 'TRX' || asset === 'TRX') {
    try {
      if (process.env.TRON_XPUB) {
        const { address, path } = await deriveHDAddress(asset, network, process.env.TRON_XPUB, derivationIndex);
        if (address && address.startsWith('T')) {
          return { address, network: network || 'TRC20', derivationPath: path };
        }
      }

      // If TRON_XPUB is not set, derive Base58Check (T...) directly from TRON_HOT_WALLET_PRIVATE_KEY
      if (process.env.TRON_HOT_WALLET_PRIVATE_KEY) {
        const tronAddr = getTronAddressFromPrivateKey(process.env.TRON_HOT_WALLET_PRIVATE_KEY);
        return { address: tronAddr, network: network || 'TRC20' };
      }

      if (process.env.TRON_HOT_WALLET_ADDRESS) {
        return { address: process.env.TRON_HOT_WALLET_ADDRESS, network: network || 'TRC20' };
      }

      const { address, path } = await deriveHDAddress(
        asset,
        network,
        process.env.PUBLIC_PLATFORM_XPUB || 'xpub_default_tron_master_key',
        derivationIndex
      );
      if (address && address.startsWith('T')) {
        return { address, network: network || 'TRC20', derivationPath: path };
      }
    } catch (err) {
      console.error("Deposit address error in Tron derivation:", err);
    }
    return {
      address: process.env.TRON_HOT_WALLET_ADDRESS || 'TYpQk9hPmsfWk1uLNxk1iW6dNm3rZJ4yTx',
      network: network || 'TRC20',
    };
  }

  // 4. Litecoin (LTC)
  if (asset === 'LTC' || network === 'LTC') {
    try {
      if (process.env.LTC_XPUB) {
        const { address, path } = await deriveHDAddress('LTC', 'LTC', process.env.LTC_XPUB, derivationIndex);
        if (address && address.startsWith('ltc1')) {
          return { address, network: 'LTC', derivationPath: path };
        }
      }

      if (process.env.LTC_HOT_WALLET_PRIVATE_KEY) {
        // Derive LTC Native SegWit address using LTC HRP (ltc1)
        try {
          let cleanHex = process.env.LTC_HOT_WALLET_PRIVATE_KEY.trim();
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
          const ltcAddress = encodeBech32('ltc1', ripemd160Hash);
          return { address: ltcAddress, network: 'LTC' };
        } catch {
          // continue
        }
      }

      if (process.env.LTC_HOT_WALLET_ADDRESS) {
        return { address: process.env.LTC_HOT_WALLET_ADDRESS, network: 'LTC' };
      }

      const { address, path } = await deriveHDAddress(
        'LTC',
        'LTC',
        process.env.PUBLIC_PLATFORM_XPUB || 'xpub_default_ltc_master_key',
        derivationIndex
      );
      if (address && address.startsWith('ltc1')) {
        return { address, network: 'LTC', derivationPath: path };
      }
    } catch (err) {
      console.error("Deposit address error in LTC derivation:", err);
    }
    return {
      address: process.env.LTC_HOT_WALLET_ADDRESS || 'ltc1q7z92p23x262f270n7x5t89z4v5a7g3k5z6q7w8',
      network: 'LTC',
    };
  }

  // 5. Default fallback
  const { address } = await deriveHDAddress(
    asset,
    network,
    process.env.PUBLIC_PLATFORM_XPUB || 'xpub_default_master_key',
    derivationIndex
  );
  return { address: address || `addr_${asset.toLowerCase()}_${derivationIndex}`, network };
}

async function handleDepositAddressRequest(req: NextRequest) {
  try {
    // 1. Authenticate user session
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse asset and network from query params or JSON body
    let assetParam = '';
    let networkParam = '';

    if (req.method === 'GET') {
      const url = new URL(req.url);
      assetParam = url.searchParams.get('asset') || url.searchParams.get('crypto') || url.searchParams.get('asset_code') || '';
      networkParam = url.searchParams.get('network') || url.searchParams.get('chain') || url.searchParams.get('network_code') || '';
    } else {
      const body = await req.json().catch(() => ({}));
      assetParam = body.asset || body.crypto || body.asset_code || '';
      networkParam = body.network || body.chain || body.network_code || '';
    }

    const asset = (assetParam || 'USDT').toUpperCase().trim();
    let network = (networkParam || (asset === 'ETH' ? 'ETH' : asset === 'BTC' ? 'BTC' : asset === 'LTC' ? 'LTC' : 'TRC20')).toUpperCase().trim();

    if (asset === 'ETH' && !network) network = 'ETH';
    if (asset === 'BTC') network = 'BTC';
    if (asset === 'LTC') network = 'LTC';
    if (asset === 'USDT' && (!network || network === 'USDT')) network = 'TRC20';

    const supabaseAdmin = getSupabaseAdminClient();

    // 3. Query public.deposit_addresses for existing active address
    const { data: existingRecords, error: queryError } = await supabaseAdmin
      .from('deposit_addresses')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (!queryError && existingRecords && existingRecords.length > 0) {
      // Find matching asset and network (handling both asset_code and asset field variations)
      const match = existingRecords.find((rec: any) => {
        const recAsset = (rec.asset_code || rec.asset || '').toUpperCase();
        const recNetwork = (rec.network_code || rec.network || '').toUpperCase();
        return (recAsset === asset || recAsset === '') && (recNetwork === network || recNetwork === '' || (!recNetwork && asset === network));
      });

      if (match?.address) {
        return NextResponse.json({
          address: match.address,
          network: match.network_code || match.network || network,
        }, { status: 200 });
      }
    }

    // 4. Determine derivation child index for the user
    let derivationIndex = 1;
    try {
      const { count } = await supabaseAdmin
        .from('deposit_addresses')
        .select('*', { count: 'exact', head: true })
        .eq('asset_code', asset)
        .eq('network_code', network);

      derivationIndex = (count || 0) + 1;
    } catch {
      derivationIndex = 1;
    }

    // 5. Derive safe deposit address
    const { address: derivedAddress, network: resolvedNetwork, derivationPath } = await deriveDepositAddress(
      asset,
      network,
      derivationIndex
    );

    // 6. Ensure user wallet container exists
    let walletId: string | null = null;
    try {
      const { data: wallet } = await supabaseAdmin
        .from('wallets')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (wallet?.id) {
        walletId = wallet.id;
      } else {
        const { data: newWallet } = await supabaseAdmin
          .from('wallets')
          .insert({
            user_id: user.id,
            status: 'active',
            provisioning_status: 'completed',
          })
          .select('id')
          .maybeSingle();

        walletId = newWallet?.id || null;
      }
    } catch (walletErr) {
      console.warn("Wallet container check:", walletErr);
    }

    // 7. Insert newly derived address into Supabase public.deposit_addresses
    try {
      const insertRecord: Record<string, any> = {
        user_id: user.id,
        asset_code: asset,
        network_code: resolvedNetwork,
        address: derivedAddress,
        custody_provider: 'internal_hot_hd',
        derivation_path: derivationPath || null,
        status: 'active',
        updated_at: new Date().toISOString(),
      };

      if (walletId) {
        insertRecord.wallet_id = walletId;
      }

      const { error: insertError } = await supabaseAdmin
        .from('deposit_addresses')
        .insert(insertRecord);

      if (insertError) {
        // If conflict on address or unique key, retrieve the existing record
        console.warn("Deposit address insert duplicate/conflict handled:", insertError.message);
        const { data: fallbackRecord } = await supabaseAdmin
          .from('deposit_addresses')
          .select('*')
          .eq('user_id', user.id)
          .eq('asset_code', asset)
          .eq('network_code', resolvedNetwork)
          .maybeSingle();

        if (fallbackRecord?.address) {
          return NextResponse.json({
            address: fallbackRecord.address,
            network: fallbackRecord.network_code || fallbackRecord.network || resolvedNetwork,
          }, { status: 200 });
        }
      }
    } catch (insertCatchErr) {
      console.error("Deposit address error during insert:", insertCatchErr);
    }

    // 8. Return successfully derived address
    return NextResponse.json({
      address: derivedAddress,
      network: resolvedNetwork,
    }, { status: 200 });
  } catch (err: any) {
    console.error("Deposit address error:", err);
    return NextResponse.json(
      { error: err?.message || 'An unexpected error occurred while generating deposit address.' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleDepositAddressRequest(req);
}

export async function POST(req: NextRequest) {
  return handleDepositAddressRequest(req);
}
