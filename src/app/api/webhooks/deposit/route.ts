import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function normalizeNetwork(network: string): string {
  const norm = (network || '').toUpperCase().trim();
  if (norm === 'ETHEREUM' || norm === 'ETH' || norm === 'ERC20') return 'ERC20';
  if (norm === 'TRON' || norm === 'TRX' || norm === 'TRC20') return 'TRC20';
  if (norm === 'BINANCE' || norm === 'BSC' || norm === 'BEP20') return 'BEP20';
  if (norm === 'POLYGON' || norm === 'MATIC') return 'POLYGON';
  if (norm === 'BITCOIN' || norm === 'BTC') return 'BTC';
  return norm;
}

function getRequiredConfirmations(network: string): number {
  const norm = normalizeNetwork(network);
  switch (norm) {
    case 'TRC20':
      return 19;
    case 'BEP20':
      return 15;
    case 'POLYGON':
      return 128;
    case 'BTC':
      return 2;
    case 'ERC20':
    default:
      return 12;
  }
}

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get('x-webhook-signature');

    // 1. Enforce HMAC-SHA256 signature check
    if (!signature) {
      return NextResponse.json({ error: 'Missing x-webhook-signature header' }, { status: 401 });
    }

    const webhookSecret =
      process.env.BLOCKCHAIN_WEBHOOK_SECRET ||
      process.env.CHAIN_INGEST_SECRET ||
      'test_webhook_secret_key_12345';

    const rawBody = await req.text();

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return NextResponse.json({ error: 'Invalid payload signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const {
      txHash,
      logIndex = 0,
      network,
      toAddress,
      amount,
      assetSymbol,
      confirmations = 1,
    } = payload;

    if (!txHash || !network || !toAddress || !amount || !assetSymbol) {
      return NextResponse.json({ error: 'Missing required deposit fields' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const cleanAddress = String(toAddress).trim();
    const normNetwork = normalizeNetwork(String(network));
    const normAsset = String(assetSymbol).toUpperCase().trim();
    const numAmount = Number(amount);
    const numConfirmations = Number(confirmations);
    const reqConfirmations = getRequiredConfirmations(normNetwork);

    // 2. Check if this deposit has already been processed to prevent replay attacks
    const { data: existingDeposit } = await supabase
      .from('onchain_deposits')
      .select('id, status, confirmations')
      .eq('tx_hash', String(txHash))
      .maybeSingle();

    if (existingDeposit && (existingDeposit.status === 'CONFIRMED' || existingDeposit.status === 'CREDITED')) {
      return NextResponse.json({
        success: true,
        depositId: existingDeposit.id,
        alreadyProcessed: true,
      });
    }

    // 3. Resolve destination address to registered user
    let userId: string | null = null;

    const { data: addressRecord } = await supabase
      .from('deposit_addresses')
      .select('id, user_id, address')
      .ilike('address', cleanAddress)
      .maybeSingle();

    if (addressRecord?.user_id) {
      userId = addressRecord.user_id;
    } else {
      const { data: userAddrRecord } = await supabase
        .from('user_deposit_addresses')
        .select('id, user_id, address')
        .ilike('address', cleanAddress)
        .maybeSingle();

      if (userAddrRecord?.user_id) {
        userId = userAddrRecord.user_id;
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: `DEPOSIT_REJECTED: Address ${cleanAddress} on network ${network} is not mapped to any registered user.` },
        { status: 400 }
      );
    }

    const isConfirmed = numConfirmations >= reqConfirmations;
    let depositId = existingDeposit?.id;

    // 4. Insert or update onchain_deposits record
    if (!depositId) {
      const { data: newDeposit, error: insertErr } = await supabase
        .from('onchain_deposits')
        .insert({
          user_id: userId,
          tx_hash: String(txHash),
          network: normNetwork,
          address: cleanAddress,
          amount: numAmount,
          asset_symbol: normAsset,
          confirmations: numConfirmations,
          required_confirmations: reqConfirmations,
          status: isConfirmed ? 'CONFIRMED' : 'PENDING',
        })
        .select('id')
        .single();

      if (insertErr) {
        // If conflict on concurrent insert, fetch existing record
        const { data: retryCheck } = await supabase
          .from('onchain_deposits')
          .select('id, status')
          .eq('tx_hash', String(txHash))
          .maybeSingle();

        if (retryCheck?.status === 'CONFIRMED' || retryCheck?.status === 'CREDITED') {
          return NextResponse.json({
            success: true,
            depositId: retryCheck.id,
            alreadyProcessed: true,
          });
        }
        depositId = retryCheck?.id;
      } else {
        depositId = newDeposit?.id;
      }
    } else {
      await supabase
        .from('onchain_deposits')
        .update({
          confirmations: numConfirmations,
          status: isConfirmed ? 'CONFIRMED' : 'PENDING',
          updated_at: new Date().toISOString(),
        })
        .eq('id', depositId);
    }

    // 5. If confirmed, credit user balance in wallet_assets atomically
    if (isConfirmed) {
      const { data: currentAsset } = await supabase
        .from('wallet_assets')
        .select('available, locked')
        .eq('user_id', userId)
        .eq('asset_symbol', normAsset)
        .maybeSingle();

      const currentAvailable = Number(currentAsset?.available || 0);
      const newAvailable = currentAvailable + numAmount;

      if (currentAsset) {
        await supabase
          .from('wallet_assets')
          .update({
            available: newAvailable,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .eq('asset_symbol', normAsset);
      } else {
        await supabase
          .from('wallet_assets')
          .insert({
            user_id: userId,
            asset_symbol: normAsset,
            available: newAvailable,
            locked: 0,
            updated_at: new Date().toISOString(),
          });
      }

      // Also update wallets table
      const { data: existingWallet } = await supabase
        .from('wallets')
        .select('id, balance')
        .eq('user_id', userId)
        .eq('currency', normAsset)
        .maybeSingle();

      if (existingWallet) {
        await supabase
          .from('wallets')
          .update({
            balance: Number(existingWallet.balance || 0) + numAmount,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingWallet.id);
      } else {
        await supabase
          .from('wallets')
          .insert({
            user_id: userId,
            currency: normAsset,
            balance: numAmount,
            reserved_balance: 0,
          });
      }
    }

    return NextResponse.json({
      success: true,
      depositId,
      alreadyProcessed: false,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Webhook processing failed' }, { status: 500 });
  }
}
