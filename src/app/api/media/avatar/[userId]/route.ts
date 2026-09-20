import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { downloadFromB2, getB2Config, getPresignedDownloadUrl, isB2Configured } from '@/lib/b2';

export const dynamic = 'force-dynamic';

// Fast memory cache for avatar buffers / redirects
const avatarCache = new Map<string, { buffer?: Buffer; contentType?: string; redirectUrl?: string; timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute in-memory cache

export async function GET(
  req: NextRequest,
  context: { params: { userId: string } | Promise<{ userId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const userId = rawParams?.userId;

    if (!userId) {
      return returnFallbackSvg();
    }

    // Check in-memory fast cache
    const cached = avatarCache.get(userId);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      if (cached.redirectUrl) {
        return NextResponse.redirect(cached.redirectUrl, {
          headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
        });
      }
      if (cached.buffer && cached.contentType) {
        return new NextResponse(cached.buffer, {
          headers: {
            'Content-Type': cached.contentType,
            'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
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
        .or(`id.eq.${userId},user_id.eq.${userId}`)
        .maybeSingle();

      if (profile) {
        profileFound = true;
        avatarUrl = profile.avatar_url || profile.photo_url || null;
      }
    } catch (dbErr) {
      console.warn('Profile fetch error in avatar media proxy:', dbErr);
    }

    // 2. Handle base64 data URIs
    if (avatarUrl && avatarUrl.startsWith('data:image/')) {
      const parts = avatarUrl.split(';base64,');
      const mimeType = parts[0].replace('data:', '');
      const base64Data = parts[1];
      const buffer = Buffer.from(base64Data, 'base64');
      avatarCache.set(userId, { buffer, contentType: mimeType, timestamp: Date.now() });
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      });
    }

    // 3. If it's an external absolute URL (e.g. Google avatar https://lh3.googleusercontent.com/...)
    if (avatarUrl && (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://'))) {
      if (!avatarUrl.includes('/api/media/avatar/')) {
        avatarCache.set(userId, { redirectUrl: avatarUrl, timestamp: Date.now() });
        return NextResponse.redirect(avatarUrl, {
          headers: {
            'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
          },
        });
      }
    }

    // 4. Attempt Backblaze B2 resolution (parallel check)
    if (isB2Configured()) {
      const urlObj = new URL(req.url);
      const reqExt = urlObj.searchParams.get('ext')?.replace('.', '').toLowerCase();

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
            avatarCache.set(userId, { buffer: fileData.buffer, contentType: ct, timestamp: Date.now() });
            return new NextResponse(fileData.buffer, {
              headers: {
                'Content-Type': ct,
                'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
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
          const presigned = await getPresignedDownloadUrl(key, 86400);
          if (presigned) {
            avatarCache.set(userId, { redirectUrl: presigned, timestamp: Date.now() });
            return NextResponse.redirect(presigned, {
              status: 307,
              headers: {
                'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
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
