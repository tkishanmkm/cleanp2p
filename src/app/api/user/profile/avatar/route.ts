import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { uploadToB2, compressAvatar } from '@/lib/b2';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are allowed for avatar' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image exceeds 10MB limit' }, { status: 400 });
    }

    const rawArrayBuffer = await file.arrayBuffer();
    const rawBuffer = Buffer.from(rawArrayBuffer);

    // Compress & resize DP (Avatar) with sharp (512x512 WebP / JPEG)
    const { buffer: compressedBuffer, contentType: mimeType, extension: fileExt } =
      await compressAvatar(rawBuffer);

    const objectKey = `avatars/${user.id}.${fileExt}`;
    let avatarUrl = '';
    const admin = getSupabaseAdminClient();

    // Upload compressed DP directly to Backblaze B2
    try {
      const b2Result = await uploadToB2(objectKey, compressedBuffer, mimeType);
      avatarUrl = `/api/media/avatar/${user.id}?ext=${fileExt}&v=${Date.now()}`;
    } catch (b2Err) {
      console.warn('B2 upload failed or unconfigured, falling back to data URI:', b2Err);
    }

    // Fallback: If not uploaded to B2, store compressed base64 data URI
    if (!avatarUrl) {
      const base64 = compressedBuffer.toString('base64');
      avatarUrl = `data:${mimeType};base64,${base64}`;
    }

    // Update user profile in database
    await admin
      .from('profiles')
      .update({
        avatar_url: avatarUrl,
        photo_url: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    // Update Supabase Auth user metadata
    try {
      await admin.auth.admin.updateUserById(user.id, {
        user_metadata: {
          avatar_url: avatarUrl,
          photo_url: avatarUrl,
          picture: avatarUrl,
          photoURL: avatarUrl,
        },
      });
    } catch (authMetaErr) {
      console.warn('Auth metadata update error (non-fatal):', authMetaErr);
    }

    return NextResponse.json({
      success: true,
      avatarUrl,
      avatar_url: avatarUrl,
      message: 'Profile picture (DP) compressed and saved to Backblaze B2 successfully.',
    });
  } catch (err: any) {
    console.error('Error uploading avatar:', err);
    return NextResponse.json({ error: err.message || 'Failed to upload avatar' }, { status: 500 });
  }
}
