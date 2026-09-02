import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { checkSupabaseConfig } from '@/lib/supabase/client';

export async function GET() {
  const config = checkSupabaseConfig();
  const hasServiceRoleKey = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY !== 'placeholder-key' &&
    process.env.SUPABASE_SERVICE_ROLE_KEY.length > 20
  );

  let connectionStatus = 'unconfigured';
  let latencyMs = 0;
  let dbError: string | null = null;
  let tablesReachable = false;

  if (config.isConfigured) {
    const start = Date.now();
    try {
      const supabase = getSupabaseAdminClient();
      const { error } = await supabase
        .from('p2p_ads')
        .select('id', { count: 'exact', head: true });

      latencyMs = Date.now() - start;

      if (error) {
        // Table might not exist yet or permission issue
        dbError = error.message;
        connectionStatus = 'connected_with_warnings';
      } else {
        connectionStatus = 'connected';
        tablesReachable = true;
      }
    } catch (err: any) {
      dbError = err?.message || 'Failed to connect to Supabase database';
      connectionStatus = 'connection_failed';
    }
  }

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    supabase: {
      isConfigured: config.isConfigured,
      hasUrl: config.hasUrl,
      hasAnonKey: config.hasAnonKey,
      hasServiceRoleKey,
      url: config.hasUrl ? config.url : 'Not configured (using placeholder)',
      connectionStatus,
      latencyMs: latencyMs > 0 ? `${latencyMs}ms` : undefined,
      tablesReachable,
      error: dbError,
    },
    requiredEnvironmentVariables: [
      {
        key: 'NEXT_PUBLIC_SUPABASE_URL',
        description: 'Your Supabase Project URL (e.g., https://yourproject.supabase.co)',
        status: config.hasUrl ? 'SET' : 'MISSING',
      },
      {
        key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        description: 'Your Supabase public anon API key',
        status: config.hasAnonKey ? 'SET' : 'MISSING',
      },
      {
        key: 'SUPABASE_SERVICE_ROLE_KEY',
        description: 'Your Supabase private service_role key (server-side operations & admin tasks)',
        status: hasServiceRoleKey ? 'SET' : 'MISSING',
      },
    ],
  });
}
