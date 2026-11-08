const WAYONES_ORIGIN = 'https://wayones.com';

function normalizeConfiguredOrigin(value: string | undefined): string {
  const candidate = value?.trim();
  if (!candidate) return WAYONES_ORIGIN;

  try {
    const parsed = new URL(candidate.includes('://') ? candidate : `https://${candidate}`);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    const isPreview = parsed.hostname.endsWith('.onrender.com') || parsed.hostname.endsWith('.vercel.app');
    if (process.env.NODE_ENV !== 'production' && (isLocal || isPreview)) {
      return parsed.origin;
    }
  } catch {
    // Invalid or legacy production URL falls back to the canonical public domain.
  }

  return WAYONES_ORIGIN;
}

export const getURL = () => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    const current = new URL(window.location.origin);
    const isLocal = current.hostname === 'localhost' || current.hostname === '127.0.0.1';
    const isPreview = current.hostname.endsWith('.onrender.com') || current.hostname.endsWith('.vercel.app');
    if (process.env.NODE_ENV !== 'production' && (isLocal || isPreview)) return current.origin;
    return WAYONES_ORIGIN;
  }

  return normalizeConfiguredOrigin(
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL
  );
};
