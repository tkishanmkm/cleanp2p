import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient, createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const authSupabase = createClient();
    const adminSupabase = getSupabaseAdminClient();

    const {
      data: { session },
      error: authError,
    } = await authSupabase.auth.getSession();

    const user = session?.user;
    if (authError || !user) {
      return NextResponse.json({ trades: [] }, { status: 200 });
    }

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');

    let query = adminSupabase
      .from('trades')
      .select('*')
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    if (statusParam) {
      const statuses = statusParam.split(',').map((s) => s.trim());
      query = query.in('status', statuses);
    }

    const { data: trades, error } = await query;

    if (error) {
      console.warn('Error fetching trades via admin client:', error);
      return NextResponse.json({ trades: [], error: error.message }, { status: 200 });
    }

    return NextResponse.json({ trades: trades || [] });
  } catch (err: any) {
    console.error('Error in /api/trades:', err);
    return NextResponse.json({ trades: [], error: err.message }, { status: 500 });
  }
}
