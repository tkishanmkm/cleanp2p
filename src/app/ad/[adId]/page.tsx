import { getAdDetails } from '@/app/ad/actions';
import { DatabaseErrorBanner } from '@/components/ui/DatabaseErrorBanner';
import { createClient } from '@/lib/supabase/server';
import { AdDetailClient } from './AdDetailClient';

interface PageProps {
  params: Promise<{ adId: string }>;
}

export default async function AdDetailPage({ params }: PageProps) {
  // 1. Resolve route parameter (Next.js 15+)
  const resolvedParams = await params;
  const rawId = resolvedParams?.adId;

  // 2. Validate route parameter
  if (!rawId || typeof rawId !== 'string' || rawId.trim() === '') {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <DatabaseErrorBanner
          error={{
            message: 'Invalid or missing ad identifier.',
            code: '400',
          }}
        />
      </main>
    );
  }

  // 3. Fetch advertisement details and current user session
  const [response, supabase] = await Promise.all([
    getAdDetails(rawId),
    createClient(),
  ]);

  let currentUserId: string | undefined;
  try {
    const { data: authData } = await supabase.auth.getUser();
    currentUserId = authData?.user?.id;
  } catch {
    // Session optional for viewing
  }

  // 4. Handle query errors or missing record
  if (response.error || !response.data) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <DatabaseErrorBanner
          error={
            response.error || {
              message: 'The requested ad was not found or may have been removed.',
              code: '404',
            }
          }
        />
      </main>
    );
  }

  const ad = response.data;

  return (
    <main className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8">
      <AdDetailClient ad={ad} currentUserId={currentUserId} />
    </main>
  );
}
