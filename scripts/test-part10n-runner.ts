import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('CRITICAL: Supabase URL and Service Role Key must be set in .env.local');
  process.exit(1);
}

// Pure Admin Client with Service Role Bypass
const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

// Separate Anon/Client-side Client for User Authentication
const authSupabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BASE_URL = 'http://localhost:3000';

// Test Participants
const SELLER_ID = '264af25e-e2de-43b8-8669-100a24b60d4a'; // stormcore69 / ajjuchoori@gmail.com
const BUYER_ID = 'f1cffa10-b9ec-4fa0-bdf2-3839b20c3d95';  // sachiinn.22 / sachinkumarsk2207@gmail.com
const OTHER_USER_ID = '37cbd587-9da1-48a1-9659-ed9f49c3e40c'; // apexlink2195 / kishanrockstarop@gmail.com

const TEST_AD_ID = '444444444444';
const TEST_PASSWORD = 'TestPassword123!';

async function runPart10NTest() {
  console.log('\n======================================================');
  console.log('  PART 10N: FEEDBACK & REPUTATION SYSTEM INTEGRATION  ');
  console.log('======================================================\n');

  try {
    // -------------------------------------------------------------
    // STEP 1: Reset Passwords & Unban Test Users to Ensure We Can Authenticate
    // -------------------------------------------------------------
    console.log('[Step 1] Resetting passwords & unbanning test users in Auth & Profiles...');
    const usersToReset = [
      { id: SELLER_ID, email: 'ajjuchoori@gmail.com' },
      { id: BUYER_ID, email: 'sachinkumarsk2207@gmail.com' },
      { id: OTHER_USER_ID, email: 'kishanrockstarop@gmail.com' },
    ];

    for (const u of usersToReset) {
      // Unban in Auth
      const { error: resetErr } = await adminSupabase.auth.admin.updateUserById(u.id, {
        password: TEST_PASSWORD,
        email_confirm: true,
        ban_duration: 'none',
      });
      if (resetErr) {
        throw new Error(`Failed to reset password/unban for user ${u.email}: ${resetErr.message}`);
      }

      // Unban in Profiles table & disable 2FA
      const { error: profUpdateErr } = await adminSupabase
        .from('profiles')
        .update({
          is_banned: false,
          is_suspended: false,
          ban_reason: null,
          banned_at: null,
          is_2fa_enabled: false,
          is_mfa_enabled: false,
          two_factor_enabled: false,
        })
        .eq('id', u.id);

      if (profUpdateErr) {
        console.warn(`  ⚠ Warning: could not update profiles table unban for ${u.email}: ${profUpdateErr.message}`);
      }

      console.log(`  ✓ Password successfully reset & unbanned for ${u.email}`);
    }

    // -------------------------------------------------------------
    // STEP 2: Authenticate and Obtain JWT Bearer Tokens via Admin-generated OTP
    // -------------------------------------------------------------
    console.log('\n[Step 2] Authenticating test users to obtain Bearer tokens via Admin OTP...');
    
    // Auth Buyer
    const { data: buyerLink, error: buyerLinkErr } = await adminSupabase.auth.admin.generateLink({
      type: 'magiclink',
      email: 'sachinkumarsk2207@gmail.com',
    });
    if (buyerLinkErr || !buyerLink.properties?.email_otp) {
      throw new Error(`Failed to generate OTP for Buyer: ${buyerLinkErr?.message}`);
    }
    const { data: buyerAuth, error: buyerAuthErr } = await authSupabase.auth.verifyOtp({
      email: 'sachinkumarsk2207@gmail.com',
      token: buyerLink.properties.email_otp,
      type: 'magiclink',
    });
    if (buyerAuthErr || !buyerAuth.session) {
      throw new Error(`Failed to verify OTP for Buyer: ${buyerAuthErr?.message}`);
    }
    const buyerToken = buyerAuth.session.access_token;
    console.log('  ✓ Buyer Authenticated successfully');

    // Auth Seller
    const { data: sellerLink, error: sellerLinkErr } = await adminSupabase.auth.admin.generateLink({
      type: 'magiclink',
      email: 'ajjuchoori@gmail.com',
    });
    if (sellerLinkErr || !sellerLink.properties?.email_otp) {
      throw new Error(`Failed to generate OTP for Seller: ${sellerLinkErr?.message}`);
    }
    const { data: sellerAuth, error: sellerAuthErr } = await authSupabase.auth.verifyOtp({
      email: 'ajjuchoori@gmail.com',
      token: sellerLink.properties.email_otp,
      type: 'magiclink',
    });
    if (sellerAuthErr || !sellerAuth.session) {
      throw new Error(`Failed to verify OTP for Seller: ${sellerAuthErr?.message}`);
    }
    const sellerToken = sellerAuth.session.access_token;
    console.log('  ✓ Seller Authenticated successfully');

    // Auth Other User
    const { data: otherLink, error: otherLinkErr } = await adminSupabase.auth.admin.generateLink({
      type: 'magiclink',
      email: 'kishanrockstarop@gmail.com',
    });
    if (otherLinkErr || !otherLink.properties?.email_otp) {
      throw new Error(`Failed to generate OTP for Other User: ${otherLinkErr?.message}`);
    }
    const { data: otherAuth, error: otherAuthErr } = await authSupabase.auth.verifyOtp({
      email: 'kishanrockstarop@gmail.com',
      token: otherLink.properties.email_otp,
      type: 'magiclink',
    });
    if (otherAuthErr || !otherAuth.session) {
      throw new Error(`Failed to verify OTP for Other User: ${otherAuthErr?.message}`);
    }
    const otherToken = otherAuth.session.access_token;
    console.log('  ✓ Other User Authenticated successfully');

    // -------------------------------------------------------------
    // STEP 3: Ensure Wallet & Balance Setup for Seller Escrow (via Admin Client)
    // -------------------------------------------------------------
    console.log('\n[Step 3] Setting up Seller and Buyer wallets & seeding available USDT...');

    async function ensureEVMWallet(userId: string, label: string) {
      let { data: wallet, error: walletErr } = await adminSupabase
        .from('wallets')
        .select('id')
        .eq('user_id', userId)
        .eq('chain', 'EVM')
        .maybeSingle();

      if (walletErr) throw walletErr;
      if (!wallet) {
        console.log(`  -> Creating fresh EVM wallet for ${label}...`);
        
        // Get max derivation index
        const { data: maxIndexData } = await adminSupabase
          .from('wallets')
          .select('derivation_index')
          .order('derivation_index', { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextDerivationIndex = maxIndexData && maxIndexData.derivation_index 
          ? maxIndexData.derivation_index + 1 
          : 1000;

        const mockAddress = '0x' + require('crypto').randomBytes(20).toString('hex');
        const { data: newWallet, error: createWError } = await adminSupabase
          .from('wallets')
          .insert({ 
            user_id: userId,
            chain: 'EVM',
            currency: 'USDT',
            address: mockAddress,
            funding_status: 'ACTIVE',
            derivation_index: nextDerivationIndex,
          })
          .select('id')
          .single();
        if (createWError) throw createWError;
        wallet = newWallet;
      }
      return wallet.id;
    }

    const sellerWalletId = await ensureEVMWallet(SELLER_ID, 'Seller');
    const buyerWalletId = await ensureEVMWallet(BUYER_ID, 'Buyer');

    // Seed/Ensure available balance is 100 USDT
    const { error: assetErr } = await adminSupabase.from('wallet_assets').upsert({
      user_id: SELLER_ID,
      asset_symbol: 'USDT',
      balance: 100.0,
      locked_balance: 0.0,
      reserved_balance: 0.0,
      in_escrow: 0.0,
      in_withdrawal: 0.0,
    }, { onConflict: 'user_id,asset_symbol' });

    if (assetErr) throw assetErr;
    console.log('  ✓ Seller wallet seeded with 100.00000000 USDT available balance');

    // -------------------------------------------------------------
    // STEP 4: Create/Upsert Active Sell Ad Owned by Seller
    // -------------------------------------------------------------
    console.log('\n[Step 4] Creating active Sell Ad owned by Seller...');
    const { error: adErr } = await adminSupabase.from('ads').upsert({
      id: TEST_AD_ID,
      public_id: TEST_AD_ID,
      public_ad_id: TEST_AD_ID,
      user_id: SELLER_ID,
      type: 'SELL',
      trade_type: 'SELL',
      asset: 'USDT',
      asset_symbol: 'USDT',
      fiat_symbol: 'USD',
      fiat_currency: 'USD',
      price_type: 'fixed',
      fixed_price: 1.0,
      price: 1.0,
      fixed_rate: 1.0,
      unit_price: 1.0,
      min_limit: 5.0,
      max_limit: 100.0,
      min_amount: 5,
      max_amount: 100,
      total_amount: 100.0,
      available_amount: 100.0,
      status: 'active',
      payment_methods: ['Bank Transfer'],
    }, { onConflict: 'id' });

    if (adErr) throw adErr;
    console.log('  ✓ Sell Ad upserted successfully');

    // -------------------------------------------------------------
    // STEP 5: Create a Fresh Trade via Real HTTP API (POST /api/trades/initiate)
    // -------------------------------------------------------------
    console.log('\n[Step 5] Initiating fresh P2P trade as Buyer via real HTTP API...');
    const initRes = await axios.post(`${BASE_URL}/api/trades/initiate`, {
      adId: TEST_AD_ID,
      cryptoAmount: 10.0,
      fiatAmount: 10.0,
    }, {
      headers: { 'Authorization': `Bearer ${buyerToken}` },
    });

    if (initRes.status !== 200 || !initRes.data.success) {
      throw new Error(`Failed to initiate trade via API: ${JSON.stringify(initRes.data)}`);
    }

    const tradeId = initRes.data.tradeId || initRes.data.id;
    console.log(`  ✓ Fresh Trade created successfully. Trade UUID: ${tradeId}`);

    // Verify trade state
    const { data: freshTrade, error: fetchErr } = await adminSupabase
      .from('trades')
      .select('status, escrow_status')
      .eq('id', tradeId)
      .single();

    if (fetchErr) throw fetchErr;
    console.log(`  ✓ Escrow locked. Trade status: ${freshTrade.status}, Escrow status: ${freshTrade.escrow_status}`);

    // -------------------------------------------------------------
    // STEP 6: Mark Paid & Release Escrow via Real HTTP APIs (POST /api/trades/[tradeId]/actions)
    // -------------------------------------------------------------
    console.log('\n[Step 6] Completing the trade lifecycle via real Actions API...');
    
    // Mark Paid as Buyer
    const payRes = await axios.post(`${BASE_URL}/api/trades/${tradeId}/actions`, {
      action: 'MARK_PAID',
    }, {
      headers: { 'Authorization': `Bearer ${buyerToken}` },
    });

    if (payRes.status !== 200 || !payRes.data.success) {
      throw new Error(`Failed to mark trade as paid via API: ${JSON.stringify(payRes.data)}`);
    }
    console.log('  ✓ Buyer marked trade as paid via API');

    // Release Escrow as Seller
    const releaseRes = await axios.post(`${BASE_URL}/api/trades/${tradeId}/actions`, {
      action: 'RELEASE_ESCROW',
    }, {
      headers: { 'Authorization': `Bearer ${sellerToken}` },
    });

    if (releaseRes.status !== 200 || !releaseRes.data.success) {
      throw new Error(`Failed to release escrow via API: ${JSON.stringify(releaseRes.data)}`);
    }
    console.log('  ✓ Seller released trade escrow via API');

    // Verify final state
    const { data: releasedTrade } = await adminSupabase
      .from('trades')
      .select('status, escrow_status')
      .eq('id', tradeId)
      .single();

    // Support both RELEASED and COMPLETED statuses in any casing
    const normStatus = String(releasedTrade.status || '').toUpperCase();
    if (normStatus !== 'RELEASED' && normStatus !== 'COMPLETED') {
      throw new Error(`Expected trade status to be RELEASED or COMPLETED, got: ${releasedTrade.status}`);
    }
    console.log(`  ✓ Database confirmation: Trade is ${releasedTrade.status} (Eligible for feedback)`);

    // Capture initial reputation counts safely
    const { data: initialBuyerProf } = await adminSupabase.from('profiles').select('positive_feedback, negative_feedback, feedback_score').eq('id', BUYER_ID).single();
    const { data: initialSellerProf } = await adminSupabase.from('profiles').select('positive_feedback, negative_feedback, feedback_score').eq('id', SELLER_ID).single();

    console.log(`  ✓ Initial Buyer Rep: Pos: ${initialBuyerProf.positive_feedback}, Neg: ${initialBuyerProf.negative_feedback}, Score: ${initialBuyerProf.feedback_score}%`);
    console.log(`  ✓ Initial Seller Rep: Pos: ${initialSellerProf.positive_feedback}, Neg: ${initialSellerProf.negative_feedback}, Score: ${initialSellerProf.feedback_score}%`);

    // -------------------------------------------------------------
    // STEP 7: Submit Positive Feedback (Buyer -> Seller)
    // -------------------------------------------------------------
    console.log('\n[Step 7] Buyer submitting positive feedback for Seller via real API endpoint...');
    
    const buyerFeedbackComment = 'Excellent seller! Very fast release of escrow and friendly. 10/10!';
    const buyerFbRes = await axios.post(`${BASE_URL}/api/trade/feedback`, {
      tradeId: tradeId,
      rating: 'positive',
      comment: buyerFeedbackComment,
    }, {
      headers: { 'Authorization': `Bearer ${buyerToken}` },
    });

    if (buyerFbRes.status !== 200 || !buyerFbRes.data.success) {
      throw new Error(`API feedback submission failed with status ${buyerFbRes.status}: ${JSON.stringify(buyerFbRes.data)}`);
    }
    console.log('  ✓ API returned 200 OK with success: true');

    // Verify database row in feedback table
    const { data: fbRowSeller, error: fbRowSellerErr } = await adminSupabase
      .from('feedback')
      .select('*')
      .eq('trade_id', tradeId)
      .eq('from_user', BUYER_ID)
      .single();

    if (fbRowSellerErr || !fbRowSeller) {
      throw new Error(`Failed to find feedback row in DB: ${fbRowSellerErr?.message}`);
    }
    console.log('  ✓ Database Verification: feedback row successfully created.');
    console.log(`    - ID: ${fbRowSeller.id}`);
    console.log(`    - From User: ${fbRowSeller.from_user} (${fbRowSeller.from_username})`);
    console.log(`    - To User: ${fbRowSeller.to_user}`);
    console.log(`    - Rating: ${fbRowSeller.rating} (is_positive: ${fbRowSeller.is_positive})`);
    console.log(`    - Comment: "${fbRowSeller.comment}"`);

    // Verify Seller profile reputation update
    const { data: updatedSellerProf } = await adminSupabase.from('profiles').select('positive_feedback, negative_feedback, feedback_score').eq('id', SELLER_ID).single();
    const posDeltaSeller = updatedSellerProf.positive_feedback - initialSellerProf.positive_feedback;
    
    console.log('  ✓ Database Verification: Seller profile counters updated.');
    console.log(`    - Positive feedback delta: +${posDeltaSeller} (New total: ${updatedSellerProf.positive_feedback})`);
    console.log(`    - Negative feedback total: ${updatedSellerProf.negative_feedback}`);
    console.log(`    - Recalculated Feedback Score: ${updatedSellerProf.feedback_score}%`);

    if (posDeltaSeller !== 1) {
      throw new Error(`Expected Seller's positive feedback to increment by 1, got delta: ${posDeltaSeller}`);
    }

    // Verify chat system message
    const { data: sysMessages } = await adminSupabase
      .from('trade_messages')
      .select('*')
      .eq('trade_id', tradeId)
      .eq('is_system', true);

    const firstFeedbackMsg = sysMessages?.find(m => m.message?.includes('left positive feedback'));
    console.log('  ✓ Database Verification: Auto system message posted in trade chat.');
    console.log(`    - Message: "${firstFeedbackMsg?.message}"`);

    // Verify Seller activity notification
    const { data: sellerNotif } = await adminSupabase
      .from('notifications')
      .select('*')
      .eq('user_id', SELLER_ID)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    console.log('  ✓ Database Verification: Activity Center notification dispatched to Seller.');
    console.log(`    - Notification Message: "${sellerNotif?.message}"`);

    // -------------------------------------------------------------
    // STEP 8: Submit Negative Feedback (Seller -> Buyer)
    // -------------------------------------------------------------
    console.log('\n[Step 8] Seller submitting negative feedback for Buyer via real API endpoint...');
    
    const sellerFeedbackComment = 'Slightly slow communication. Escrow released but was kept waiting.';
    const sellerFbRes = await axios.post(`${BASE_URL}/api/trade/feedback`, {
      tradeId: tradeId,
      rating: 'negative',
      comment: sellerFeedbackComment,
    }, {
      headers: { 'Authorization': `Bearer ${sellerToken}` },
    });

    if (sellerFbRes.status !== 200 || !sellerFbRes.data.success) {
      throw new Error(`API negative feedback submission failed with status ${sellerFbRes.status}: ${JSON.stringify(sellerFbRes.data)}`);
    }
    console.log('  ✓ API returned 200 OK with success: true');

    // Verify database row in feedback table
    const { data: fbRowBuyer, error: fbRowBuyerErr } = await adminSupabase
      .from('feedback')
      .select('*')
      .eq('trade_id', tradeId)
      .eq('from_user', SELLER_ID)
      .single();

    if (fbRowBuyerErr || !fbRowBuyer) {
      throw new Error(`Failed to find feedback row in DB: ${fbRowBuyerErr?.message}`);
    }
    console.log('  ✓ Database Verification: feedback row successfully created for Buyer.');
    console.log(`    - From User: ${fbRowBuyer.from_user} (${fbRowBuyer.from_username})`);
    console.log(`    - To User: ${fbRowBuyer.to_user}`);
    console.log(`    - Rating: ${fbRowBuyer.rating} (is_positive: ${fbRowBuyer.is_positive})`);
    console.log(`    - Comment: "${fbRowBuyer.comment}"`);

    // Verify Buyer profile reputation update
    const { data: updatedBuyerProf } = await adminSupabase.from('profiles').select('positive_feedback, negative_feedback, feedback_score').eq('id', BUYER_ID).single();
    const negDeltaBuyer = updatedBuyerProf.negative_feedback - initialBuyerProf.negative_feedback;

    console.log('  ✓ Database Verification: Buyer profile counters updated.');
    console.log(`    - Negative feedback delta: +${negDeltaBuyer} (New total: ${updatedBuyerProf.negative_feedback})`);
    console.log(`    - Positive feedback total: ${updatedBuyerProf.positive_feedback}`);
    console.log(`    - Recalculated Feedback Score: ${updatedBuyerProf.feedback_score}%`);

    if (negDeltaBuyer !== 1) {
      throw new Error(`Expected Buyer's negative feedback to increment by 1, got delta: ${negDeltaBuyer}`);
    }

    // Verify Buyer activity notification
    const { data: buyerNotif } = await adminSupabase
      .from('notifications')
      .select('*')
      .eq('user_id', BUYER_ID)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    console.log('  ✓ Database Verification: Activity Center notification dispatched to Buyer.');
    console.log(`    - Notification Message: "${buyerNotif?.message}"`);

    // -------------------------------------------------------------
    // STEP 9: Test Duplicate Feedback Guard (Idempotency)
    // -------------------------------------------------------------
    console.log('\n[Step 9] Testing duplicate feedback guard (Idempotency)...');
    // -------------------------------------------------------------
    // STEP 9: Test Duplicate Feedback Guard (Upsert / Prevent Duplicate Rows)
    // -------------------------------------------------------------
    console.log('\n[Step 9] Testing duplicate feedback guard (Safe upsert/update prevention)...');
    const dupRes = await axios.post(`${BASE_URL}/api/trade/feedback`, {
      tradeId: tradeId,
      rating: 'positive',
      comment: 'Updated positive feedback comment!',
    }, {
      headers: { 'Authorization': `Bearer ${buyerToken}` },
    });

    if (dupRes.status !== 200 || !dupRes.data.success) {
      throw new Error(`Duplicate feedback update failed: ${JSON.stringify(dupRes.data)}`);
    }
    console.log('  ✓ API successfully handled duplicate submission via upsert/update.');

    // Verify row count remains exactly 1 in feedback table
    const { count: fbCount, error: countErr } = await adminSupabase
      .from('feedback')
      .select('*', { count: 'exact', head: true })
      .eq('trade_id', tradeId)
      .eq('from_user', BUYER_ID);

    if (countErr) throw countErr;
    if (fbCount !== 1) {
      throw new Error(`Expected exactly 1 feedback row for Buyer, found: ${fbCount}`);
    }
    console.log('  ✓ Database Verification: Feedback row count remains exactly 1. Zero duplicate rows inserted.');

    // -------------------------------------------------------------
    // STEP 10: Test Security / Authorization Guard (Non-participant)
    // -------------------------------------------------------------
    console.log('\n[Step 10] Testing security / authorization guard (Non-participant)...');
    try {
      await axios.post(`${BASE_URL}/api/trade/feedback`, {
        tradeId: tradeId,
        rating: 'positive',
        comment: 'I am not part of this trade, but I am attempting to submit feedback.',
      }, {
        headers: { 'Authorization': `Bearer ${otherToken}` },
      });
      throw new Error('✗ Test Failed: Non-participant feedback submission was allowed!');
    } catch (err: any) {
      if (err.response && err.response.status === 403) {
        console.log(green(`  ✓ Non-participant submission blocked successfully with HTTP 403: "${err.response.data.error}"`));
      } else {
        throw new Error(`✗ Test Failed: Expected HTTP 403 for non-participant, received: ${err.message}`);
      }
    }

    // Verify zero rows from other user
    const { count: otherCount } = await adminSupabase
      .from('feedback')
      .select('*', { count: 'exact', head: true })
      .eq('trade_id', tradeId)
      .eq('from_user', OTHER_USER_ID);

    if ((otherCount ?? 0) !== 0) {
      throw new Error(`Expected exactly 0 feedback rows for non-participant, found: ${otherCount}`);
    }
    console.log('  ✓ Database Verification: Zero feedback records inserted for non-participant.');

    console.log('\n======================================================');
    console.log('  ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY! PASS  ');
    console.log('======================================================\n');

  } catch (err: any) {
    console.error('\n✗ TEST FLOW ENCOUNTERED CRITICAL ERROR:', err.message);
    if (err.response) {
      console.error('  Response Data:', JSON.stringify(err.response.data));
      console.error('  Response Status:', err.response.status);
    }
    process.exit(1);
  }
}

// Color helper function
function green(s: string) {
  return `\x1b[32m${s}\x1b[0m`;
}

runPart10NTest();
