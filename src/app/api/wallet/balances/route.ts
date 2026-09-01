import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { createPublicClient, http, formatEther } from 'viem';
import { mainnet, sepolia, arbitrum, base, polygon } from 'viem/chains';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const address = url.searchParams.get('address');

    let ethBalance = '0.0000';
    let arbBalance = '0.0000';
    let baseBalance = '0.0000';
    let polyBalance = '0.0000';
    let btcBalance = '0.0000';

    const supabaseAdmin = getSupabaseAdminClient();

    // Query DB balances if user deposit address exists
    if (address) {
      const { data: addrRecord } = await supabaseAdmin
        .from('user_deposit_addresses')
        .select('user_id')
        .eq('address', address.toLowerCase())
        .maybeSingle();

      if (addrRecord?.user_id) {
        const { data: dbBalances } = await supabaseAdmin
          .from('wallet_balances')
          .select('asset_symbol, network, balance')
          .eq('user_id', addrRecord.user_id);

        if (dbBalances) {
          for (const item of dbBalances) {
            const val = parseFloat(item.balance || '0').toFixed(4);
            if (item.network === 'ethereum' || item.asset_symbol === 'ETH') ethBalance = val;
            if (item.network === 'arbitrum' || item.asset_symbol === 'ARB') arbBalance = val;
            if (item.network === 'base') baseBalance = val;
            if (item.network === 'polygon' || item.asset_symbol === 'POL') polyBalance = val;
            if (item.network === 'bitcoin' || item.asset_symbol === 'BTC') btcBalance = val;
          }
        }
      }
    }

    // Attempt RPC on-chain query if RPC is configured and address is valid EVM
    if (address && address.startsWith('0x') && address.length === 42 && process.env.EVM_RPC_URL) {
      try {
        const client = createPublicClient({
          chain: sepolia,
          transport: http(process.env.EVM_RPC_URL),
        });
        const onChainBal = await client.getBalance({ address: address as `0x${string}` });
        ethBalance = parseFloat(formatEther(onChainBal)).toFixed(4);
      } catch {
        // Fallback to database balance
      }
    }

    return NextResponse.json({
      success: true,
      balances: [
        { network: 'Ethereum (Sepolia)', symbol: 'ETH', balance: ethBalance },
        { network: 'Arbitrum', symbol: 'ETH', balance: arbBalance },
        { network: 'Base', symbol: 'ETH', balance: baseBalance },
        { network: 'Polygon', symbol: 'POL', balance: polyBalance },
        { network: 'Bitcoin', symbol: 'BTC', balance: btcBalance },
      ],
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      balances: [
        { network: 'Ethereum', symbol: 'ETH', balance: '0.0000' },
        { network: 'Arbitrum', symbol: 'ETH', balance: '0.0000' },
        { network: 'Base', symbol: 'ETH', balance: '0.0000' },
        { network: 'Polygon', symbol: 'POL', balance: '0.0000' },
      ],
      error: err.message,
    });
  }
}
