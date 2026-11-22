import { NextResponse } from 'next/server';
import { executeCanonicalWithdrawal } from '@/lib/services/withdrawalService';

export const dynamic = 'force-dynamic';

const MAX_WITHDRAWAL_REQUEST_BYTES = 4 * 1024;

async function readBoundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_WITHDRAWAL_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_WITHDRAWAL_REQUEST_BYTES) {
      return NextResponse.json({ error: 'Withdrawal request body is too large.' }, { status: 413 });
    }

    const rawBody = await readBoundedBody(req);
    if (rawBody === null) {
      return NextResponse.json({ error: 'Withdrawal request body is too large.' }, { status: 413 });
    }

    let body: Record<string, any>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ error: 'Invalid withdrawal request body.' }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Malformed JSON request body.' }, { status: 400 });
    }

    const authHeader = req.headers.get('authorization');
    const idempotencyKey = req.headers.get('x-idempotency-key');

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
  } catch {
    console.error('[withdrawal-request] Unexpected failure while processing withdrawal request');
    return NextResponse.json(
      { error: 'Unable to process the withdrawal request. Please check your withdrawal history before retrying.' },
      { status: 500 }
    );
  }
}
