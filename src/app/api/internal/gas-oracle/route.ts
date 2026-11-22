import { NextRequest, NextResponse } from 'next/server';
import { getCachedGasFees } from '@/lib/gas-oracle';
import { fetchAndCacheNetworkGasFees } from '@/lib/gas-oracle-server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const crypto = searchParams.get('crypto')?.trim().toUpperCase() || 'BTC';
    const network = searchParams.get('network')?.trim().toUpperCase() || crypto;

    // Only serve explicitly supported asset/network pairs. Without this guard,
    // arbitrary symbols fall through to generic EVM estimates and a $1 price
    // fallback, which can produce misleading fee quotes.
    const supportedPairs = new Set([
      'BTC:BTC',
      'ETH:ETH',
      'USDT:ERC20',
      'USDT:BEP20',
      'USDT:TRC20',
      'USDC:ERC20',
      'TRX:TRX',
      'LTC:LTC',
      'BNB:BSC',
    ]);

    if (crypto.length > 12 || network.length > 12 || !supportedPairs.has(`${crypto}:${network}`)) {
      return NextResponse.json({ error: 'Unsupported asset/network pair.' }, { status: 400 });
    }

    const gasFees = await getCachedGasFees(crypto, network);

    if (!gasFees) {
      return NextResponse.json(
        { error: `Gas fees could not be estimated for ${crypto}/${network}` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      crypto,
      network,
      gasFees,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Failed to retrieve gas fees: ${message}` },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    // Validate secret header
    const providedSecret =
      req.headers.get('x-gas-oracle-secret') ||
      req.headers.get('x-service-key') ||
      req.headers.get('authorization')?.replace('Bearer ', '');
    const configuredSecret =
      process.env.GAS_ORACLE_SECRET ||
      process.env.CHAIN_INGEST_SECRET ||
      process.env.PROVISION_SERVICE_KEY;

    let isAuthorized = false;
    if (configuredSecret && providedSecret === configuredSecret) {
      isAuthorized = true;
    } else if (process.env.NODE_ENV === 'development' && !configuredSecret) {
      // Never permit unauthenticated cache refreshes in production when the
      // worker secret is missing or misconfigured.
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing gas oracle secret header.' },
        { status: 401 }
      );
    }

    // Refresh and cache network gas fees across all chains
    const updatedFees = await fetchAndCacheNetworkGasFees();

    return NextResponse.json({
      success: true,
      message: 'Network gas fees successfully fetched and updated.',
      count: updatedFees.length,
      fees: updatedFees,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Gas oracle update failed: ${message}` },
      { status: 500 }
    );
  }
}
