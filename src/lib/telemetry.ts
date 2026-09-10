import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export interface SecurityTelemetryPayload {
  userId?: string | null;
  action: string;
  eventType?: string;
  targetId?: string | null;
  ip?: string;
  userAgent?: string;
  browser?: string;
  os?: string;
  deviceType?: string;
  deviceFingerprint?: string;
  language?: string;
  metadata?: Record<string, any>;
  isSuspicious?: boolean;
  suspicionReason?: string;
}

/**
 * Extracts client IP and device headers from Next.js request
 */
export function extractClientTelemetry(req: NextRequest | Request): Partial<SecurityTelemetryPayload> {
  let ip = 'unknown';
  let userAgent = '';
  let language = 'en';

  if ('headers' in req) {
    const headers = req.headers;
    ip = 
      headers.get('cf-connecting-ip') ||
      headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      headers.get('x-real-ip') ||
      '127.0.0.1';
    
    userAgent = headers.get('user-agent') || 'unknown';
    language = headers.get('accept-language')?.split(',')[0] || 'en';
  }

  // Parse rudimentary browser & OS from user-agent
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';
  let deviceType = 'Desktop';

  if (/mobile/i.test(userAgent)) {
    deviceType = 'Mobile';
  } else if (/tablet|ipad/i.test(userAgent)) {
    deviceType = 'Tablet';
  }

  if (/chrome|crios/i.test(userAgent) && !/edge|edg|opr\//i.test(userAgent)) {
    browser = 'Chrome';
  } else if (/safari/i.test(userAgent) && !/chrome|crios/i.test(userAgent)) {
    browser = 'Safari';
  } else if (/firefox|fxios/i.test(userAgent)) {
    browser = 'Firefox';
  } else if (/edg/i.test(userAgent)) {
    browser = 'Edge';
  }

  if (/windows/i.test(userAgent)) {
    os = 'Windows';
  } else if (/macintosh|mac os/i.test(userAgent)) {
    os = 'macOS';
  } else if (/android/i.test(userAgent)) {
    os = 'Android';
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    os = 'iOS';
  } else if (/linux/i.test(userAgent)) {
    os = 'Linux';
  }

  return {
    ip,
    userAgent,
    browser,
    os,
    deviceType,
    language,
  };
}

/**
 * Logs a security or authentication audit event
 */
export async function logSecurityEvent(payload: SecurityTelemetryPayload) {
  try {
    const adminSupabase = createAdminClient();
    
    const details = {
      ip: payload.ip || '127.0.0.1',
      user_agent: payload.userAgent,
      browser: payload.browser,
      os: payload.os,
      device_type: payload.deviceType,
      device_fingerprint: payload.deviceFingerprint,
      language: payload.language,
      is_suspicious: payload.isSuspicious ?? false,
      suspicion_reason: payload.suspicionReason,
      timestamp: new Date().toISOString(),
      ...(payload.metadata || {}),
    };

    // Try inserting into admin_audit_logs
    await adminSupabase.from('admin_audit_logs').insert({
      admin_id: payload.userId || '00000000-0000-0000-0000-000000000000',
      action: payload.action || payload.eventType || 'SECURITY_EVENT',
      target_id: payload.targetId || payload.userId || null,
      details,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[TELEMETRY] Failed to record security event:', err);
  }
}
