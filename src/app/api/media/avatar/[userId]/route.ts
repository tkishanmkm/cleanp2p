import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { downloadFromB2, getB2Config, getPresignedDownloadUrl, isB2Configured } from '@/lib/b2';

export const dynamic = 'force-dynamic';

// Fast memory cache for avatar buffers / redirects
const avatarCache = new Map<string, { buffer?: Buffer; contentType?: string; redirectUrl?: string; timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000;
const MAX_AVATAR_CACHE_ENTRIES = 500;
const AVATAR_USER_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cacheAvatar(key: string, value: { buffer?: Buffer; contentType?: string; redirectUrl?: string; timestamp: number }): void {
  const now = Date.now();
  for (const [cacheKey, entry] of avatarCache) {
    if (now - entry.timestamp >= CACHE_TTL_MS) avatarCache.delete(cacheKey);
  }
  if (!avatarCache.has(key) && avatarCache.size >= MAX_AVATAR_CACHE_ENTRIES) {
    const oldestKey = avatarCache.keys().next().value;
    if (oldestKey) avatarCache.delete(oldestKey);
  }
  avatarCache.set(key, value);
}

function isAllowedExternalAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const allowedHost =
      hostname === 'avatars.githubusercontent.com' ||
      hostname === 'secure.gravatar.com' ||
      hostname === 'www.gravatar.com' ||
      hostname === 'cdn.discordapp.com' ||
      hostname === 'platform-lookaside.fbsbx.com' ||
      hostname.endsWith('.fbcdn.net') ||
      hostname.endsWith('.googleusercontent.com');
    return url.protocol === 'https:' &&
      allowedHost &&
      !url.username &&
      !url.password &&
      (url.port === '' || url.port === '443') &&
      !url.hash;
  } catch {
    return false;
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const userId = rawParams?.userId;

    if (!userId || !AVATAR_USER_ID_REGEX.test(userId)) {
      return returnFallbackSvg();
    }

    // Check in-memory fast cache
    const cached = avatarCache.get(userId);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      if (cached.redirectUrl) {
        return NextResponse.redirect(cached.redirectUrl, {
          headers: { 'Cache-Control': 'public, max-age=600, stale-while-revalidate=900' },
        });
      }
      if (cached.buffer && cached.contentType) {
        return new NextResponse(new Uint8Array(cached.buffer), {
          headers: {
            'Content-Type': cached.contentType,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'public, max-age=600, stale-while-revalidate=900',
          },
        });
      }
    }

    // 1. Fetch Profile using Admin client
    let avatarUrl: string | null = null;
    let profileFound = false;
    try {
      const admin = getSupabaseAdminClient();
      const { data: profile } = await admin
        .from('profiles')
        .select('avatar_url, photo_url')
        .eq('id', userId)
        .maybeSingle();

      if (profile) {
        profileFound = true;
        avatarUrl = profile.avatar_url || profile.photo_url || null;
      }

    } catch (dbErr) {
      console.warn('Profile fetch error in avatar media proxy:', dbErr);
    }

    if (avatarUrl && typeof avatarUrl === 'string') {
      avatarUrl = avatarUrl.trim();
      if (avatarUrl === '') avatarUrl = null;
    }

    // 2. Handle base64 data URIs
    if (avatarUrl && avatarUrl.startsWith('data:')) {
      const match = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(avatarUrl);
      if (!match || match[2].length % 4 !== 0 || match[2].length > 2_800_000) {
        return returnFallbackSvg();
      }
      const mimeType = match[1].toLowerCase();
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) {
        return returnFallbackSvg();
      }
      cacheAvatar(userId, { buffer, contentType: mimeType, timestamp: Date.now() });
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': mimeType,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=600, stale-while-revalidate=900',
        },
      });
    }

    // 3. If it's an external absolute URL (e.g. Google avatar https://lh3.googleusercontent.com/...)
    if (avatarUrl && /^https?:/i.test(avatarUrl)) {
      if (isAllowedExternalAvatarUrl(avatarUrl)) {
        cacheAvatar(userId, { redirectUrl: avatarUrl, timestamp: Date.now() });
        return NextResponse.redirect(avatarUrl, {
          headers: {
            'Cache-Control': 'public, max-age=600, stale-while-revalidate=900',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      // Do not reflect arbitrary user-supplied URLs as redirects.
      return returnFallbackSvg();
    }

    // 4. Attempt Backblaze B2 resolution (parallel check)
    if (isB2Configured()) {
      const urlObj = new URL(req.url);
      const requestedExtension = urlObj.searchParams.get('ext')?.replace(/^\./, '').toLowerCase();
      const reqExt = requestedExtension && ['webp', 'jpg', 'jpeg', 'png'].includes(requestedExtension)
        ? requestedExtension
        : null;

      const candidateKeys: string[] = [];
      if (reqExt) {
        candidateKeys.push(`avatars/${userId}.${reqExt}`);
      }
      candidateKeys.push(
        `avatars/${userId}.webp`,
        `avatars/${userId}.jpg`,
        `avatars/${userId}.png`,
        `avatars/${userId}`
      );

      // Try candidates
      for (const key of candidateKeys) {
        try {
          const fileData = await downloadFromB2(key);
          if (fileData && fileData.buffer && fileData.buffer.length > 0) {
            const ct = fileData.contentType || (key.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
            cacheAvatar(userId, { buffer: fileData.buffer, contentType: ct, timestamp: Date.now() });
            return new NextResponse(new Uint8Array(fileData.buffer), {
              headers: {
                'Content-Type': ct,
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'public, max-age=600, stale-while-revalidate=900',
              },
            });
          }
        } catch {
          // continue
        }
      }

      // Presigned URL
      for (const key of candidateKeys) {
        try {
          const presigned = await getPresignedDownloadUrl(key, 900);
          if (presigned) {
            cacheAvatar(userId, { redirectUrl: presigned, timestamp: Date.now() });
            return NextResponse.redirect(presigned, {
              status: 307,
              headers: {
                'Cache-Control': 'public, max-age=600, stale-while-revalidate=900',
              },
            });
          }
        } catch {
          // continue
        }
      }
    }

    // Fallback: return a clean default SVG avatar
    return returnFallbackSvg();
  } catch (error) {
    console.error('Avatar proxy error:', error);
    return returnFallbackSvg();
  }
}

function returnFallbackSvg() {
  const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="50" fill="#E2E8F0"/><circle cx="50" cy="38" r="18" fill="#94A3B8"/><path d="M22 84 C22 64 36 58 50 58 C64 58 78 64 78 84 Z" fill="#94A3B8"/></svg>`;
  return new NextResponse(fallbackSvg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=600',
    },
  });
}
