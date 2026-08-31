import { NextRequest, NextResponse } from 'next/server';
import { fetchAndCacheNetworkGasFees, getCachedGasFees } from '@/lib/gas-oracle';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const crypto = searchParams.get('crypto')?.toUpperCase() || 'BTC';
    const network = searchParams.get('network')?.toUpperCase() || crypto;

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
    } else if (process.env.NODE_ENV === 'development' || !configuredSecret) {
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
