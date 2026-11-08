import { NextRequest, NextResponse } from 'next/server';
import { deleteFromB2 } from '@/lib/b2';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const ALLOWED_AVATAR_EXTENSIONS = new Set(['webp', 'jpg', 'jpeg', 'png']);

function extractAvatarObjectKey(rawUrl: unknown, userId: string): string | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;

  if (rawUrl.startsWith('/api/media/avatar/')) {
    const parsed = new URL(rawUrl, 'https://Wayones.invalid');
    const extension = String(parsed.searchParams.get('ext') || '').toLowerCase();
    if (ALLOWED_AVATAR_EXTENSIONS.has(extension)) return `avatars/${userId}.${extension}`;
    const filename = decodeURIComponent(parsed.pathname.split('/').pop() || '');
    const expected = new RegExp('^' + userId + '\\.(webp|jpg|jpeg|png)$', 'i');
    return expected.test(filename) ? `avatars/${filename}` : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!parsed.hostname.toLowerCase().includes('backblazeb2.com')) return null;

  const bucketName = process.env.B2_BUCKET_NAME || process.env.AWS_BUCKET_NAME || '';
  if (!bucketName) return null;
  const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  let key: string | null = null;
  if (segments[0] === 'file' && segments[1] === bucketName) {
    key = segments.slice(2).join('/');
  } else if (parsed.hostname.toLowerCase().startsWith(`${bucketName.toLowerCase()}.s3.`)) {
    key = segments.join('/');
  } else if (segments[0] === bucketName) {
    key = segments.slice(1).join('/');
  }

  if (!key || !key.startsWith(`avatars/${userId}.`)) return null;
  const extension = key.split('.').pop()?.toLowerCase() || '';
  return ALLOWED_AVATAR_EXTENSIONS.has(extension) ? key : null;
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization') || '';
  if (!configuredSecret || authorization !== `Bearer ${configuredSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: queueItems, error: queueError } = await supabaseAdmin
    .from('account_deletion_cleanup_queue')
    .select('user_id, b2_cleanup_required, avatar_url, photo_url')
    .is('completed_at', null)
    .order('created_at', { ascending: true })
    .limit(50);

  if (queueError) {
    console.error('Account deletion cleanup queue query failed:', queueError);
    return NextResponse.json({ error: 'Cleanup queue is unavailable.' }, { status: 503 });
  }

  let processed = 0;
  let failed = 0;

  for (const item of queueItems || []) {
    try {
      const userId = String(item.user_id);

      if (item.b2_cleanup_required) {
        const storedUrls = [item.avatar_url, item.photo_url].filter((value): value is string => typeof value === 'string' && value.length > 0);
        const directB2Urls = storedUrls.filter((value) => new RegExp('backblazeb2\\.com', 'i').test(value));
        const directB2Keys = directB2Urls.map((value) => extractAvatarObjectKey(value, userId));
        if (directB2Keys.some((key) => !key)) {
          throw new Error('A legacy Backblaze avatar URL could not be mapped safely to its object key.');
        }
        const apiAvatarKeys = storedUrls
          .filter((value) => value.startsWith('/api/media/avatar/'))
          .map((value) => extractAvatarObjectKey(value, userId))
          .filter((key): key is string => Boolean(key));
        const extractedKeys = [...new Set([...directB2Keys, ...apiAvatarKeys].filter((key): key is string => Boolean(key)))];
        const keys = extractedKeys.length > 0
          ? extractedKeys
          : [
              `avatars/${userId}.webp`,
              `avatars/${userId}.jpg`,
              `avatars/${userId}.png`,
              `avatars/${userId}.jpeg`,
            ];
        const deletionResults = await Promise.all(keys.map((key) => deleteFromB2(key)));
        if (deletionResults.some((success) => !success)) {
          throw new Error('One or more profile-picture objects could not be deleted from Backblaze B2.');
        }
      }

      const { error: authMetadataError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          avatar_url: null,
          photo_url: null,
          picture: null,
          photoURL: null,
          full_name: null,
          name: null,
          dob: null,
          date_of_birth: null,
          profile_picture: null,
          profilePicture: null,
          avatar: null,
          photo: null,
          image_url: null,
        },
      });
      if (authMetadataError) throw authMetadataError;

      const { error: queueUpdateError } = await supabaseAdmin
        .from('account_deletion_cleanup_queue')
        .update({ completed_at: new Date().toISOString(), last_error: null, avatar_url: null, photo_url: null })
        .eq('user_id', userId);
      if (queueUpdateError) throw queueUpdateError;

      processed += 1;
    } catch (error: any) {
      failed += 1;
      const safeError = String(error?.message || 'Cleanup failed').slice(0, 200);
      await supabaseAdmin
        .from('account_deletion_cleanup_queue')
        .update({ last_error: safeError })
        .eq('user_id', item.user_id);
      console.error('Account deletion cleanup item failed; it will be retried.');
    }
  }

  return NextResponse.json({ processed, failed, remaining: Math.max(0, (queueItems || []).length - processed) });
}
