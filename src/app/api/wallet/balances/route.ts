import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { createPublicClient, http, formatEther } from 'viem';
import { mainnet } from 'viem/chains';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const address = url.searchParams.get('address')?.toLowerCase().trim() || '';

    let ethBalance = 0;
    let usdtBalance = 0;
    let btcBalance = 0;
    let ltcBalance = 0;

    const supabaseAdmin = getSupabaseAdminClient();

    let targetUserId: string | null = null;

    if (address) {
      // 1. Find user from public.wallets
      const { data: walletRecord } = await supabaseAdmin
        .from('wallets')
        .select('user_id, balance, available_balance, chain')
        .ilike('address', address)
        .maybeSingle();

      if (walletRecord?.user_id) {
        targetUserId = walletRecord.user_id;
        if (walletRecord.balance) {
          ethBalance = Math.max(ethBalance, Number(walletRecord.balance));
        }
      }

      // 2. Fallback check deposit_addresses
      if (!targetUserId) {
        const { data: depRecord } = await supabaseAdmin
          .from('deposit_addresses')
          .select('user_id')
          .ilike('address', address)
          .maybeSingle();
        if (depRecord?.user_id) targetUserId = depRecord.user_id;
      }

      // 3. Fallback check user_deposit_addresses
      if (!targetUserId) {
        const { data: uDepRecord } = await supabaseAdmin
          .from('user_deposit_addresses')
          .select('user_id')
          .ilike('address', address)
          .maybeSingle();
        if (uDepRecord?.user_id) targetUserId = uDepRecord.user_id;
      }

      // 4. Fallback check onchain_deposits
      if (!targetUserId) {
        const { data: onchainRecord } = await supabaseAdmin
          .from('onchain_deposits')
          .select('user_id')
          .ilike('address', address)
          .maybeSingle();
        if (onchainRecord?.user_id) targetUserId = onchainRecord.user_id;
      }
    }

    // If targetUserId is found, aggregate balances across profiles & onchain_deposits
    if (targetUserId) {
      // Check public.profiles
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('eth_balance, usdt_balance, btc_balance, ltc_balance')
        .eq('id', targetUserId)
        .maybeSingle();

      if (profile) {
        if (profile.eth_balance) ethBalance = Math.max(ethBalance, Number(profile.eth_balance));
        if (profile.usdt_balance) usdtBalance = Math.max(usdtBalance, Number(profile.usdt_balance));
        if (profile.btc_balance) btcBalance = Math.max(btcBalance, Number(profile.btc_balance));
        if (profile.ltc_balance) ltcBalance = Math.max(ltcBalance, Number(profile.ltc_balance));
      }

      // Check all wallets rows for this user
      const { data: allWallets } = await supabaseAdmin
        .from('wallets')
        .select('chain, currency, balance, available_balance')
        .eq('user_id', targetUserId);

      if (allWallets) {
        for (const w of allWallets) {
          const bal = Number(w.balance || w.available_balance || 0);
          if (w.chain === 'EVM' || w.currency === 'ETH') {
            ethBalance = Math.max(ethBalance, bal);
          } else if (w.chain === 'BTC' || w.currency === 'BTC') {
            btcBalance = Math.max(btcBalance, bal);
          } else if (w.chain === 'LTC' || w.currency === 'LTC') {
            ltcBalance = Math.max(ltcBalance, bal);
          } else if (w.currency === 'USDT') {
            usdtBalance = Math.max(usdtBalance, bal);
          }
        }
      }

      // Check confirmed onchain_deposits sum
      const { data: confirmedDeposits } = await supabaseAdmin
        .from('onchain_deposits')
        .select('asset_symbol, amount, status')
        .eq('user_id', targetUserId)
        .eq('status', 'CONFIRMED');

      if (confirmedDeposits && confirmedDeposits.length > 0) {
        let sumEth = 0;
        let sumUsdt = 0;
        let sumBtc = 0;
        let sumLtc = 0;
        for (const d of confirmedDeposits) {
          const amt = Number(d.amount || 0);
          const sym = (d.asset_symbol || '').toUpperCase();
          if (sym === 'ETH') sumEth += amt;
          else if (sym === 'USDT') sumUsdt += amt;
          else if (sym === 'BTC') sumBtc += amt;
          else if (sym === 'LTC') sumLtc += amt;
        }
        ethBalance = Math.max(ethBalance, sumEth);
        usdtBalance = Math.max(usdtBalance, sumUsdt);
        btcBalance = Math.max(btcBalance, sumBtc);
        ltcBalance = Math.max(ltcBalance, sumLtc);
      }
    }

    // On-chain RPC balance check for live EVM address
    if (address && address.startsWith('0x') && address.length === 42) {
      try {
        const client = createPublicClient({
          chain: mainnet,
          transport: http(process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com'),
        });
        const onChainBal = await client.getBalance({ address: address as `0x${string}` });
        const onChainEth = parseFloat(formatEther(onChainBal));
        if (onChainEth > 0) {
          ethBalance = Math.max(ethBalance, onChainEth);
        }
      } catch {
        // Ignore RPC errors and fallback to DB balance
      }
    }

    return NextResponse.json({
      success: true,
      balances: [
        { network: 'Ethereum Mainnet', symbol: 'ETH', balance: ethBalance.toFixed(4) },
        { network: 'USDT (All Chains)', symbol: 'USDT', balance: usdtBalance.toFixed(2) },
        { network: 'Bitcoin', symbol: 'BTC', balance: btcBalance.toFixed(6) },
        { network: 'Litecoin', symbol: 'LTC', balance: ltcBalance.toFixed(4) },
      ],
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      balances: [
        { network: 'Ethereum Mainnet', symbol: 'ETH', balance: '0.0000' },
        { network: 'USDT (All Chains)', symbol: 'USDT', balance: '0.00' },
        { network: 'Bitcoin', symbol: 'BTC', balance: '0.000000' },
        { network: 'Litecoin', symbol: 'LTC', balance: '0.0000' },
      ],
      error: err.message,
    });
  }
}
