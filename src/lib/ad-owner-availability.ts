import { NextResponse } from 'next/server';

export async function checkAdOwnerAvailability(supabase: any, adId: string, idempotencyKey: string): Promise<NextResponse | null> {
  const { data, error } = await supabase.rpc('record_ad_offline_open_attempt', { p_ad_id: adId, p_idempotency_key: idempotencyKey });
  if (error) {
    console.error('Advertisement availability check failed:', error.code || 'UNKNOWN');
    return NextResponse.json({ success: false, code: 'AD_AVAILABILITY_CHECK_FAILED', error: 'We could not verify whether the advertiser is online. Please try again.' }, { status: 503 });
  }
  const result = data as { ad_found?: boolean; ad_active?: boolean; seller_online?: boolean; attempts?: number; deactivated?: boolean } | null;
  if (!result?.ad_found) return NextResponse.json({ success: false, code: 'AD_NOT_FOUND', error: 'Advertisement not found or no longer available.' }, { status: 404 });
  if (result.ad_active === false) return NextResponse.json({ success: false, code: result.deactivated ? 'AD_AUTO_PAUSED_OFFLINE' : 'AD_NOT_ACTIVE', attempts: result.attempts ?? 0, error: result.deactivated ? 'This advertisement was automatically paused because its owner was offline for three trade-opening attempts.' : 'This advertisement is not active. Please choose another advertisement.' }, { status: 409 });
  if (result.seller_online !== true) return NextResponse.json({ success: false, code: 'AD_OWNER_OFFLINE', attempts: result.attempts ?? 0, remainingAttempts: Math.max(0, 3 - (result.attempts ?? 0)), error: 'The advertiser is currently offline. Please try again when they are online.' }, { status: 409 });
  return null;
}
