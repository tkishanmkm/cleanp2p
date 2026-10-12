import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const testBuyerEmail = process.env.TEST_P2P_BUYER_EMAIL;
const testAdId = process.env.TEST_P2P_AD_ID;

if (!supabaseUrl || !serviceRoleKey || !anonKey || !testBuyerEmail || !testAdId) {
  throw new Error(
    'RPC test requires a dedicated test project plus SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, TEST_P2P_BUYER_EMAIL, and TEST_P2P_AD_ID.'
  );
}

const parsedSupabaseUrl = new URL(supabaseUrl);
if (parsedSupabaseUrl.hostname.startsWith('eaiwgfxoiwxepinvcykg.')) {
  throw new Error('RPC test is blocked from running against the production Supabase project.');
}

const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function testRpc() {
  const authSupabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: bLink, error: linkError } = await adminSupabase.auth.admin.generateLink({
    type: 'magiclink',
    email: testBuyerEmail,
  });
  if (linkError || !bLink?.properties?.email_otp) {
    throw new Error(`Unable to generate test login link: ${linkError?.message || 'OTP missing'}`);
  }
  const { data: bAuth, error: authError } = await authSupabase.auth.verifyOtp({
    email: testBuyerEmail,
    token: bLink.properties.email_otp,
    type: 'magiclink',
  });
  if (authError || !bAuth.session?.access_token) {
    throw new Error(`Unable to authenticate test buyer: ${authError?.message || 'session missing'}`);
  }

  const buyerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${bAuth.session?.access_token}` } }
  });

  const { data, error } = await buyerClient.rpc('initiate_trade_with_escrow', {
    p_ad_id: testAdId,
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
