import { NextRequest, NextResponse } from 'next/server';
import { executeCanonicalWithdrawal } from '@/lib/services/withdrawalService';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const authHeader = req.headers.get('authorization');
    const idempotencyKey = req.headers.get('x-idempotency-key');
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;

    const result = await executeCanonicalWithdrawal({
      asset: payload.asset || payload.assetSymbol || payload.asset_symbol || payload.crypto,
      amount: payload.amount ?? payload.amountEth ?? payload.amountUsdt,
      network: payload.network || payload.chain || payload.networkCode,
      destinationAddress: payload.destinationAddress || payload.destination_address || payload.recipientAddress || payload.address || payload.toAddress,
      totpCode: payload.totpCode || payload.totp_code || payload.code,
      idempotencyKey: idempotencyKey || (typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : undefined),
      authHeader,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || result.message },
        { status: result.statusCode || 400 }
      );
    }

    return NextResponse.json({
      success: true,
      withdrawalId: result.withdrawalId,
      status: result.status,
      asset: result.asset,
      network: result.network,
      destinationAddress: result.destinationAddress,
      amountRequested: result.amountRequested,
      networkFee: result.networkFee,
      totalDebited: result.totalDebited,
      message: result.message,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
