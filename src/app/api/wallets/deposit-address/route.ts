import { NextRequest } from 'next/server';
import { handleSecureDepositAddressRequest } from '@/lib/wallet/secure-deposit-address';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return handleSecureDepositAddressRequest(req, 'deposit');
}

export async function POST(req: NextRequest) {
  return handleSecureDepositAddressRequest(req, 'deposit');
}
