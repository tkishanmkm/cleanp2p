import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getPresignedDownloadUrl } from '@/lib/b2';

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

    if (!profile || !avatarUrl) {
      // Fallback: return a clean default SVG avatar
      const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
        <rect width="100" height="100" fill="#1e293b"/>
        <circle cx="50" cy="38" r="18" fill="#64748b"/>
        <path d="M22 84 C22 64 36 58 50 58 C64 58 78 64 78 84 Z" fill="#64748b"/>
      </svg>`;
      return new NextResponse(fallbackSvg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // Handle base64 data URIs
    if (avatarUrl.startsWith('data:image/')) {
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

    // If it's already an external absolute URL (e.g. https://...)
    if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
      return NextResponse.redirect(avatarUrl, {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=300',
        },
      });
    }

    // Generate short-lived signed B2 URL and redirect user seamlessly
    try {
      const signedUrl = await getPresignedDownloadUrl(avatarUrl, 300);
      return NextResponse.redirect(signedUrl, {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=300',
        },
      });
    } catch (b2Err) {
      console.error('B2 presigned URL generation error:', b2Err);
      const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
        <rect width="100" height="100" fill="#1e293b"/>
        <circle cx="50" cy="38" r="18" fill="#64748b"/>
        <path d="M22 84 C22 64 36 58 50 58 C64 58 78 64 78 84 Z" fill="#64748b"/>
      </svg>`;
      return new NextResponse(fallbackSvg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=60',
        },
      });
    }
  } catch (error) {
    console.error('Avatar proxy error:', error);
    const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
      <rect width="100" height="100" fill="#1e293b"/>
      <circle cx="50" cy="38" r="18" fill="#64748b"/>
      <path d="M22 84 C22 64 36 58 50 58 C64 58 78 64 78 84 Z" fill="#64748b"/>
    </svg>`;
    return new NextResponse(fallbackSvg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=60',
      },
    });
  }
}
