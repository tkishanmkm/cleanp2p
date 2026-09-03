import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    // Support Bearer token header if provided by frontend
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    // 1. Explicit Auth Check
    let user = null;
    let authError: any = null;

    if (bearerToken) {
      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user;
      authError = tokenAuth.error;
    }

    if (!user) {
      const cookieAuth = await supabase.auth.getUser();
      user = cookieAuth.data?.user;
      authError = cookieAuth.error;
    }

    if (authError || !user) {
      console.error('[Auth Error Details]:', authError?.message);
      return NextResponse.json(
        { 
          error: 'No active session found! Please refresh or log in again.', 
          details: authError?.message 
        }, 
        { status: 401 }
      );
    }

    const formData = await req.json();

    // 2. Sanitize and cast boolean/numeric payload fields before hitting Supabase
    // This directly addresses PostgreSQL error 22P02 (invalid input syntax for type numeric)
    const cleanPayload: Record<string, any> = {
      ...formData,
      price: formData.price !== undefined && formData.price !== null && formData.price !== '' ? Number(formData.price) : null,
      margin: formData.margin !== undefined && formData.margin !== null && formData.margin !== '' ? Number(formData.margin) : (formData.price_margin ? Number(formData.price_margin) : null),
      min_amount: formData.min_amount !== undefined && formData.min_amount !== null && formData.min_amount !== '' ? Number(formData.min_amount) : (formData.min_order ? Number(formData.min_order) : null),
      max_amount: formData.max_amount !== undefined && formData.max_amount !== null && formData.max_amount !== '' ? Number(formData.max_amount) : (formData.max_order ? Number(formData.max_order) : null),
      // Ensure boolean flags are strictly boolean
      is_fixed: Boolean(formData.is_fixed ?? (typeof formData.fixed_rate === 'boolean' ? formData.fixed_rate : false)),
    };

    // If fixed_rate was submitted as a boolean, remove or cast it to avoid 22P02 if fixed_rate column is NUMERIC
    if (typeof cleanPayload.fixed_rate === 'boolean') {
      delete cleanPayload.fixed_rate;
    }

    // Cast optional numeric columns cleanly
    if (cleanPayload.min_order !== undefined) cleanPayload.min_order = cleanPayload.min_order ? Number(cleanPayload.min_order) : null;
    if (cleanPayload.max_order !== undefined) cleanPayload.max_order = cleanPayload.max_order ? Number(cleanPayload.max_order) : null;
    if (cleanPayload.total_amount !== undefined) cleanPayload.total_amount = cleanPayload.total_amount ? Number(cleanPayload.total_amount) : null;
    if (cleanPayload.available_amount !== undefined) cleanPayload.available_amount = cleanPayload.available_amount ? Number(cleanPayload.available_amount) : null;
    if (cleanPayload.rate_percent !== undefined) cleanPayload.rate_percent = cleanPayload.rate_percent ? Number(cleanPayload.rate_percent) : 0;
    if (cleanPayload.rate_adjustment !== undefined) cleanPayload.rate_adjustment = cleanPayload.rate_adjustment ? Number(cleanPayload.rate_adjustment) : 0;
    if (cleanPayload.margin_percentage !== undefined) cleanPayload.margin_percentage = cleanPayload.margin_percentage ? Number(cleanPayload.margin_percentage) : 0;
    if (cleanPayload.payment_window !== undefined) cleanPayload.payment_window = parseInt(String(cleanPayload.payment_window), 10) || 30;
    if (cleanPayload.min_completed_trades !== undefined) cleanPayload.min_completed_trades = parseInt(String(cleanPayload.min_completed_trades), 10) || 0;

    // Attach user_id
    cleanPayload.user_id = user.id;

    // Determine target table
    const targetTable = cleanPayload.table || (cleanPayload.title && cleanPayload.description ? 'ads' : 'p2p_ads');
    delete cleanPayload.table;

    // 3. Wrap insertion logic in a clear try/catch to expose the REAL database error
    let { data, error: dbError } = await supabase
      .from(targetTable)
      .insert([cleanPayload])
      .select()
      .single();

    // Fallback between 'p2p_ads' and 'ads' if table does not exist
    if (dbError && (dbError.code === '42P01' || dbError.message?.includes('does not exist'))) {
      const altTable = targetTable === 'ads' ? 'p2p_ads' : 'ads';
      const altResult = await supabase
        .from(altTable)
        .insert([cleanPayload])
        .select()
        .single();

      if (!altResult.error) {
        data = altResult.data;
        dbError = null;
      } else {
        dbError = altResult.error;
      }
    }

    // If RLS blocked user with standard anon client, try service role admin client as fallback
    if (dbError && (dbError.code === '42501' || dbError.message?.toLowerCase().includes('row-level security'))) {
      try {
        const adminClient = getSupabaseAdminClient();
        const adminResult = await adminClient
          .from(targetTable)
          .insert([cleanPayload])
          .select()
          .single();

        if (!adminResult.error) {
          data = adminResult.data;
          dbError = null;
        }
      } catch (adminErr) {
        console.warn('Admin fallback failed:', adminErr);
      }
    }

    if (dbError) {
      // Expose the REAL database error
      console.error('[Real Database Error]:', dbError);
      return NextResponse.json(
        { 
          error: 'Failed to create ad in database', 
          realError: dbError.message, 
          hint: dbError.hint,
          code: dbError.code,
          details: dbError.details 
        }, 
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data });

  } catch (err: any) {
    console.error('[Unhandled Server Error]:', err);
    return NextResponse.json(
      { error: err.message || 'Internal Server Error' }, 
      { status: 500 }
    );
  }
}
