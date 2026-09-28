import { NextResponse } from 'next/server';
import { executeCanonicalWithdrawal } from '@/lib/services/withdrawalService';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    const idempotencyKey = request.headers.get('x-idempotency-key');
    const body = await request.json().catch(() => ({}));

    const result = await executeCanonicalWithdrawal({
      asset: body.asset || body.assetSymbol || body.asset_symbol || body.crypto,
      amount: body.amount ?? body.amountEth ?? body.amountUsdt,
      network: body.network || body.chain || body.networkCode,
      destinationAddress: body.destinationAddress || body.destination_address || body.recipientAddress || body.address || body.toAddress,
      totpCode: body.totpCode || body.totp_code || body.code,
      idempotencyKey: idempotencyKey || body.idempotencyKey,
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
