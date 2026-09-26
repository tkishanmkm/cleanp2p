import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export async function GET() {
  const targetTxHash = '189079c39ef192fe8d20cf2abef610daea9f33a15f975d1cb9c058ae510a2b7e';
  const targetUserId = '37cbd587-9da1-48a1-9659-ed9f49c3e40c';
  const targetAddress = 'TEHuvkNzdaQbCRPWudV85ux4FRGPXjAyNn';

  const supabase = getSupabaseAdminClient();

  const profiles = await supabase.from('profiles').select('*').eq('id', targetUserId);
  const userDepAddrs = await supabase.from('user_deposit_addresses').select('*').eq('user_id', targetUserId);
  const depAddrs = await supabase.from('deposit_addresses').select('*').eq('address', targetAddress);
  const wallets = await supabase.from('wallets').select('*').eq('user_id', targetUserId);
  const onchain = await supabase.from('onchain_deposits').select('*').ilike('tx_hash', targetTxHash);
  const deposits = await supabase.from('deposits').select('*').ilike('txid', targetTxHash);
  const ledger = await supabase.from('ledger_entries').select('*').eq('user_id', targetUserId);

  return NextResponse.json({
    envCheck: {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'using fallback',
      hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hasAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    },
    profiles,
    userDepAddrs,
    depAddrs,
    wallets,
    onchain,
    deposits,
    ledger,
  });
}
