import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

const BRANDING_KEYS = new Set([
  'appLogo', 'appLogoDesktop', 'appLogoMobile', 'appName',
  'primaryColor', 'accentColor', 'btcLogo', 'ethLogo', 'ltcLogo', 'usdtLogo',
]);

const WAYONES_DEFAULT_BRANDING: Record<string, string> = {
  appName: 'Wayones',
  appLogo: '/logo-desktop.webp',
  appLogoDesktop: '/logo-desktop.webp',
  appLogoMobile: '/logo-mobile.webp',
};

function parseBranding(value: unknown): Record<string, string> {
  let parsed: Record<string, string> = {};
  if (typeof value === 'string') {
    try {
      const decoded: unknown = JSON.parse(value);
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        parsed = Object.fromEntries(
          Object.entries(decoded).filter(([key, item]) => BRANDING_KEYS.has(key) && typeof item === 'string')
        ) as Record<string, string>;
      }
    } catch {
      parsed = {};
    }
  }

  // A previous release could have persisted the former brand name and logo.
  // Replace that one-time legacy configuration with the supplied Wayones
  // assets. Subsequent admin-managed Wayones logo changes remain supported.
  const hasWayonesBrand = parsed.appName?.trim().toLowerCase() === 'wayones';
  return {
    ...parsed,
    ...(!hasWayonesBrand ? WAYONES_DEFAULT_BRANDING : {}),
    appName: 'Wayones',
  };
}

// Branding is public display configuration; app_settings is service-role-only.
export async function GET() {
  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('value')
      .eq('key', 'branding')
      .maybeSingle();

    if (error) throw error;
    return NextResponse.json({ success: true, branding: parseBranding(data?.value) });
  } catch (error: unknown) {
    console.error('[Branding API] Read failed:', error);
    return NextResponse.json({ error: 'Unable to load branding settings.' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) return auth.response!;

    const body = await req.json().catch(() => null);
    if (!body || !body.branding || typeof body.branding !== 'object' || Array.isArray(body.branding)) {
      return NextResponse.json({ error: 'A branding object is required.' }, { status: 400 });
    }

    const entries = Object.entries(body.branding);
    if (entries.some(([key, value]) =>
      !BRANDING_KEYS.has(key) || typeof value !== 'string' || value.length > 2_000_000
    )) {
      return NextResponse.json({ error: 'Branding contains an unsupported or oversized value.' }, { status: 400 });
    }

    const branding = {
      ...(Object.fromEntries(entries) as Record<string, string>),
      appName: 'Wayones',
    };
    const supabaseAdmin = getSupabaseAdminClient();
    const { error } = await supabaseAdmin
      .from('app_settings')
      .upsert(
        { key: 'branding', value: JSON.stringify(branding), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

    if (error) throw error;
    return NextResponse.json({ success: true, branding });
  } catch (error: unknown) {
    console.error('[Branding API] Write failed:', error);
    return NextResponse.json({ error: 'Unable to save branding settings.' }, { status: 500 });
  }
}
