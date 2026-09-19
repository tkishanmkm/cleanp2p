import { NextRequest } from 'next/server';
import { POST as handleDiditWebhook } from '@/app/api/webhooks/didit/route';

export const dynamic = 'force-dynamic';

/**
 * Endpoint: /api/didit/webhook
 * Proxies directly to the canonical Didit webhook handler.
 */
export async function POST(req: NextRequest) {
  return handleDiditWebhook(req);
}
