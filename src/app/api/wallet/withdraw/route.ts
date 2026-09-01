import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const supabaseAdmin = getSupabaseAdminClient();

    // 1. Check authenticated user session (via cookies or Bearer Authorization header)
    let user: any = null;

    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      try {
        const { data, error } = await supabaseAdmin.auth.getUser(token);
        if (!error && data?.user) {
          user = data.user;
        }
      } catch {
        // Fallback to cookie check
      }
    }

    if (!user) {
      const { data: { user: cookieUser }, error: authError } = await supabase.auth.getUser();
      if (!authError && cookieUser) {
        user = cookieUser;
      }
    }

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const asset = body.asset || body.assetSymbol || body.asset_symbol;
    const amount = body.amount ?? body.amountEth;
    const destinationAddress = body.destinationAddress || body.destination_address || body.recipientAddress || body.address;

    if (!asset || amount === undefined || amount === null || !destinationAddress) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: asset, amount, and destinationAddress are required' },
        { status: 400 }
      );
    }

    const parsedAmount = typeof amount === 'number' ? amount : parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Amount must be a positive number' },
        { status: 400 }
      );
    }

    const assetSymbol = String(asset).toUpperCase();

    // 2. Execute withdrawal stored procedure in Supabase
    const { data, error } = await supabase.rpc('process_withdrawal', {
      p_user_id: user.id,
      p_asset_symbol: assetSymbol,
      p_amount: parsedAmount,
      p_destination_address: String(destinationAddress).trim(),
    });

    if (error) {
      // If RPC is not found or fails with permissions, check if admin RPC is required
      if (error.message?.includes('function process_withdrawal') || error.code === '42883') {
        const { data: adminRpcData, error: adminRpcError } = await supabaseAdmin.rpc('process_withdrawal', {
          p_user_id: user.id,
          p_asset_symbol: assetSymbol,
          p_amount: parsedAmount,
          p_destination_address: String(destinationAddress).trim(),
        });

        if (adminRpcError) {
          return NextResponse.json({ success: false, error: adminRpcError.message }, { status: 400 });
        }

        return NextResponse.json({ success: true, result: adminRpcData });
      }

      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, result: data });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
