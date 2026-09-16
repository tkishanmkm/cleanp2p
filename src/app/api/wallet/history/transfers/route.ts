import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function mapStatusToDbValues(statusInput: string): string[] {
  const norm = statusInput.trim().toUpperCase();
  switch (norm) {
    case 'PENDING':
    case 'PROCESSING':
      return ['pending', 'PENDING', 'processing', 'PROCESSING'];
    case 'CONFIRMED':
    case 'COMPLETED':
      return ['confirmed', 'CONFIRMED', 'completed', 'COMPLETED'];
    case 'FAILED':
    case 'REJECTED':
    case 'CANCELLED':
      return ['failed', 'FAILED', 'rejected', 'REJECTED', 'cancelled', 'CANCELLED'];
    default:
      return [statusInput.toLowerCase(), statusInput.toUpperCase()];
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '20', 10);

    const page = Math.max(1, isNaN(rawPage) ? 1 : rawPage);
    const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 20 : rawLimit));
    const offset = (page - 1) * limit;

    const statusParam = searchParams.get('status');
    const assetParam = searchParams.get('asset');

    const admin = getSupabaseAdminClient();

    let query = admin
      .from('transfers')
      .select('*', { count: 'exact' })
      .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`);

    if (statusParam) {
      const allowedStatuses = mapStatusToDbValues(statusParam);
      query = query.in('status', allowedStatuses);
    }

    if (assetParam) {
      const assetClean = assetParam.trim();
      query = query.or(`crypto.ilike.${assetClean},asset_symbol.ilike.${assetClean}`);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching transfer history:', error);
      return NextResponse.json({ error: error.message || 'Failed to fetch transfer history' }, { status: 500 });
    }

    const totalCount = count ?? 0;
    const totalPages = Math.ceil(totalCount / limit);

    // Extract all unique user IDs to fetch their real profile.username from profiles table
    const userIdsToFetch = new Set<string>();
    (data || []).forEach((t: any) => {
      if (t.sender_id) userIdsToFetch.add(t.sender_id);
      if (t.recipient_id) userIdsToFetch.add(t.recipient_id);
    });

    const profileMap: Record<string, string> = {};
    if (userIdsToFetch.size > 0) {
      try {
        const { data: profs } = await admin
          .from('profiles')
          .select('id, username')
          .in('id', Array.from(userIdsToFetch));

        if (profs) {
          profs.forEach((p: any) => {
            if (p.id && p.username) {
              profileMap[p.id] = p.username;
            }
          });
        }

        // Check any missing users directly from auth.admin
        const missingIds = Array.from(userIdsToFetch).filter((id) => !profileMap[id]);
        if (missingIds.length > 0) {
          try {
            const { data: authData } = await admin.auth.admin.listUsers();
            if (authData?.users) {
              for (const u of authData.users) {
                if (missingIds.includes(u.id)) {
                  const resolvedUName = u.user_metadata?.username || u.email?.split('@')[0] || `user_${u.id.slice(0, 6)}`;
                  profileMap[u.id] = resolvedUName;
                  // Auto-heal profile record in background
                  admin.from('profiles').upsert({ id: u.id, username: resolvedUName, email: u.email }).then();
                }
              }
            }
          } catch (authErr) {
            console.warn('Auth fallback for profiles notice:', authErr);
          }
        }
      } catch (profErr) {
        console.warn('Error batch-resolving profiles for transfers:', profErr);
      }
    }

    const formattedData = (data || []).map((transfer: any) => {
      const isSender = transfer.sender_id === user.id;
      const type: 'SENT' | 'RECEIVED' = isSender ? 'SENT' : 'RECEIVED';
      const amountStr = transfer.amount != null ? String(transfer.amount) : '0';
      const feeVal = transfer.fee != null ? transfer.fee : (transfer.fee_amount != null ? transfer.fee_amount : (Number(transfer.amount || 0) * 0.015));
      const feeStr = String(feeVal);
      const assetSymbol = (transfer.crypto || transfer.asset_symbol || transfer.coin || 'USDT').toUpperCase();

      // Strictly resolve usernames from profiles table map
      const senderUsername = profileMap[transfer.sender_id] || transfer.sender_username || (isSender ? 'You' : 'Trader');
      const recipientUsername = profileMap[transfer.recipient_id] || transfer.recipient_username || (!isSender ? 'You' : 'Trader');

      return {
        id: transfer.id,
        public_id: transfer.public_id || transfer.transfer_id || transfer.id,
        transferId: transfer.public_id || transfer.transfer_id || transfer.id,
        type,
        sender_id: transfer.sender_id,
        recipient_id: transfer.recipient_id,
        sender_username: senderUsername,
        recipient_username: recipientUsername,
        amount: amountStr,
        fee_amount: feeStr,
        fee: Number(feeVal),
        crypto: assetSymbol,
        asset_symbol: assetSymbol,
        status: (transfer.status || 'completed').toLowerCase(),
        created_at: transfer.created_at || new Date().toISOString(),
      };
    });

    return NextResponse.json({
      data: formattedData,
      page,
      limit,
      total_count: totalCount,
      total_pages: totalPages,
    });
  } catch (err: any) {
    console.error('Unexpected error in transfer history API:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
}
