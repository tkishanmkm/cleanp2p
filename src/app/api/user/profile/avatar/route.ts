import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { uploadToB2 } from '@/lib/b2';

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

    const fileExt = file.name.split('.').pop() || 'jpg';
    const objectKey = `avatars/${user.id}_${Date.now()}.${fileExt}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to Backblaze B2
    await uploadToB2(objectKey, buffer, file.type);

    // Update user profile
    await supabase
      .from('profiles')
      .update({ avatar_url: objectKey })
      .eq('id', user.id);

    return NextResponse.json({
      success: true,
      avatar_url: objectKey,
      media_url: `/api/media/avatar/${user.id}`,
    });
  } catch (err: any) {
    console.error('Error uploading avatar:', err);
    return NextResponse.json({ error: err.message || 'Failed to upload avatar' }, { status: 500 });
  }
}
