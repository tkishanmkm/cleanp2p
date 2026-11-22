import { NextRequest } from 'next/server';
import { POST as initiateKyc } from '@/app/api/kyc/initiate/route';

export const dynamic = 'force-dynamic';

/**
 * Backward-compatible alias. All Didit sessions must be created through the
 * canonical endpoint so session registration and retry accounting stay atomic.
 */
export async function POST(req: NextRequest) {
  return initiateKyc(req);
}
