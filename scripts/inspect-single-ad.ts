import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

async function inspect() {
  const { data: adFromAds } = await adminSupabase.from('ads').select('*').eq('id', '111111111111').single();
  console.log('adFromAds:', adFromAds);

  const { data: adFromP2P } = await adminSupabase.from('p2p_ads').select('*').eq('id', '111111111111').maybeSingle();
  console.log('adFromP2P:', adFromP2P);

  const { data: latestTrade } = await adminSupabase.from('trades').select('*').order('created_at', { ascending: false }).limit(1).single();
  console.log('latestTrade:', latestTrade);
}

inspect();
