import { NextRequest } from 'next/server';
import { POST as diditWebhookPost } from '@/app/api/webhooks/didit/route';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return diditWebhookPost(req);
}


