import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { downloadFromB2, getPresignedDownloadUrl, isB2Configured } from '@/lib/b2';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: { userId: string } | Promise<{ userId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const userId = rawParams.userId;

    const supabase = await createClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('avatar_url, photo_url')
      .eq('id', userId)
      .maybeSingle();

    const avatarUrl = profile?.avatar_url || profile?.photo_url;

    // 1. Handle base64 data URIs
    if (avatarUrl && avatarUrl.startsWith('data:image/')) {
      const parts = avatarUrl.split(';base64,');
      const mimeType = parts[0].replace('data:', '');
      const base64Data = parts[1];
      const buffer = Buffer.from(base64Data, 'base64');
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    // 2. If it's an external absolute URL (e.g. Google avatar https://lh3.googleusercontent.com/...)
    if (avatarUrl && (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://'))) {
      if (!avatarUrl.includes('/api/media/avatar/')) {
        return NextResponse.redirect(avatarUrl, {
          headers: {
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    }

    // 3. Attempt direct download from Backblaze B2 (Key: avatars/{userId}.webp)
    if (isB2Configured()) {
      const candidateKeys = [
        `avatars/${userId}.webp`,
        `avatars/${userId}.jpg`,
        `avatars/${userId}.png`,
      ];

      for (const key of candidateKeys) {
        try {
          const fileData = await downloadFromB2(key);
          if (fileData && fileData.buffer) {
            return new NextResponse(fileData.buffer, {
              headers: {
                'Content-Type': fileData.contentType || 'image/webp',
                'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
              },
            });
          }
        } catch {
          // continue checking
        }
      }
    }

    // Fallback: return a clean default SVG avatar matching the app
    const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="50" fill="#E2E8F0"/><path d="M50 45C56.6274 45 62 39.6274 62 33C62 26.3726 56.6274 21 50 21C43.3726 21 38 26.3726 38 33C38 39.6274 43.3726 45 50 45Z" fill="#94A3B8"/><path d="M75 79C75 68.5228 63.8071 60 50 60C36.1929 60 25 68.5228 25 79H75Z" fill="#94A3B8"/></svg>`;
    return new NextResponse(fallbackSvg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Avatar proxy error:', error);
    const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="50" fill="#E2E8F0"/><circle cx="50" cy="38" r="18" fill="#94A3B8"/><path d="M22 84 C22 64 36 58 50 58 C64 58 78 64 78 84 Z" fill="#94A3B8"/></svg>`;
    return new NextResponse(fallbackSvg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }
}
