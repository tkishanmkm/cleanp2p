import { NextRequest, NextResponse } from 'next/server';
import { generateP2PCompliancePayload, AssistantRequest } from '@/lib/p2p-compliance-assistant';

export async function POST(req: NextRequest) {
  try {
    const body: AssistantRequest = await req.json();

    if (!body.systemMessageType) {
      return NextResponse.json(
        { success: false, error: 'Missing systemMessageType in assistant request payload' },
        { status: 400 }
      );
    }

    const payload = generateP2PCompliancePayload(body);

    return NextResponse.json({
      success: true,
      ...payload
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
