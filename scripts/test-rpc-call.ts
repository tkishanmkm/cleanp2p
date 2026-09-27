import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

async function testRpc() {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const authSupabase = createClient(supabaseUrl, anonKey);
  const { data: bLink } = await adminSupabase.auth.admin.generateLink({
    type: 'magiclink',
    email: 'sachinkumarsk2207@gmail.com',
  });
  const { data: bAuth } = await authSupabase.auth.verifyOtp({
    email: 'sachinkumarsk2207@gmail.com',
    token: bLink!.properties!.email_otp!,
    type: 'magiclink',
  });

  const buyerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${bAuth.session?.access_token}` } }
  });

  const { data, error } = await buyerClient.rpc('initiate_trade_with_escrow', {
    p_ad_id: '111111111111',
    p_crypto_amount: 5.0,
    p_fiat_amount: 5.0,
    p_fiat_currency: 'USD',
    p_price: 1.0,
    p_payment_method: 'UPI',
    p_trade_ref: 'TEST12345678',
    p_idempotency_key: null,
  });
  console.log('rpc result:', data, error);

  if (data?.trade_id) {
    const { data: t } = await adminSupabase.from('trades').select('*').eq('id', data.trade_id).single();
    console.log('resulting trade payment_method:', t.payment_method);
  }
}

testRpc();
