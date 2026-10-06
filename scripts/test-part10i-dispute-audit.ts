import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !serviceRoleKey) {
  console.error('CRITICAL: Supabase URL and Service Role Key must be set in .env.local');
  process.exit(1);
}

const adminSupabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const authSupabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BASE_URL = 'http://localhost:3000';

const SELLER_ID = 'e18ebe69-e614-4ce1-b8d5-6b859c738713';
const SELLER_EMAIL = 'paxones-test-seller-prod01@paxones.com';

const BUYER_ID = '7d821d7d-d3bc-4249-9661-294376c21b29';
const BUYER_EMAIL = 'paxones-test-buyer-prod01@paxones.com';

const ADMIN_ID = '8925fed8-c8bf-44a3-97fa-bd806aade05a';
const ADMIN_EMAIL = 'tkishanmkm@gmail.com';

const ORDINARY_USER_ID = 'c9043023-fdfb-431f-8d31-7f166f242bf9';
const ORDINARY_USER_EMAIL = 'painy9814@gmail.com';

const AD_ID = 'xwli2o05fh6x';

async function getBearerToken(email: string): Promise<string> {
  const { data, error } = await adminSupabase.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
  });
  if (error || !data.properties?.email_otp) {
    throw new Error(`generateLink failed for ${email}: ${error?.message || 'no otp'}`);
  }
  const { data: authData, error: authErr } = await authSupabase.auth.verifyOtp({
    email,
    token: data.properties.email_otp,
    type: 'magiclink',
  });
  if (authErr || !authData.session?.access_token) {
    throw new Error(`verifyOtp failed for ${email}: ${authErr?.message || 'no token'}`);
  }
  return authData.session.access_token;
}

async function getWalletSnapshot(userId: string) {
  const { data, error } = await adminSupabase
    .from('wallet_assets')
    .select('*')
    .eq('user_id', userId)
    .eq('asset_symbol', 'USDT')
    .single();
  if (error) throw error;
  return {
    user_id: data.user_id,
    balance: Number(data.balance),
    in_escrow: Number(data.in_escrow),
    locked_balance: Number(data.locked_balance),
    reserved_balance: Number(data.reserved_balance),
    in_withdrawal: Number(data.in_withdrawal),
  };
}

async function getLegacyCounts() {
  const [w, ub, uw, pt] = await Promise.all([
    adminSupabase.from('wallets').select('id', { count: 'exact', head: true }),
    adminSupabase.from('user_balances').select('id', { count: 'exact', head: true }),
    adminSupabase.from('user_wallets').select('id', { count: 'exact', head: true }),
    adminSupabase.from('p2p_trades').select('id', { count: 'exact', head: true }),
  ]);
  return {
    wallets: w.count ?? 0,
    user_balances: ub.count ?? 0,
    user_wallets: uw.count ?? 0,
    p2p_trades: pt.count ?? 0,
  };
}

async function runPart10IAudit() {
  console.log('===============================================================');
  console.log('  PART 10I: LIVE PRODUCTION ADMIN DISPUTE RESOLUTION AUDIT    ');
  console.log('===============================================================\n');

  // Obtain Tokens
  console.log('[Auth] Obtaining Bearer tokens for all actors...');
  const sellerToken = await getBearerToken(SELLER_EMAIL);
  const buyerToken = await getBearerToken(BUYER_EMAIL);
  const adminToken = await getBearerToken(ADMIN_EMAIL);
  const ordinaryToken = await getBearerToken(ORDINARY_USER_EMAIL);
  console.log('  ✓ All 4 auth tokens successfully issued.\n');

  // Initial Snapshot
  const initialSellerSnap = await getWalletSnapshot(SELLER_ID);
  const initialBuyerSnap = await getWalletSnapshot(BUYER_ID);
  const initialLegacy = await getLegacyCounts();

  console.log('[Baseline Snapshots]');
  console.log('  Seller USDT:', initialSellerSnap);
  console.log('  Buyer USDT:', initialBuyerSnap);
  console.log('  Legacy Table Counts:', initialLegacy);
  console.log('');

  // Activate Seller Ad for trade creation
  console.log('[Ad Setup] Ensuring seller test ad is ACTIVE...');
  const toggleRes = await fetch(`${BASE_URL}/api/ads/${AD_ID}/toggle`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${sellerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ active: true, status: 'ACTIVE' }),
  });
  const toggleData = await toggleRes.json();
  console.log('  Toggle ad result:', toggleRes.status, toggleData);

  // =========================================================================
  // TEST A: BUYER-WIN DISPUTE RESOLUTION
  // =========================================================================
  console.log('\n-------------------------------------------------------------');
  console.log('  TEST A: BUYER-WIN DISPUTE WORKFLOW (MODERATOR AWARDS BUYER) ');
  console.log('-------------------------------------------------------------');

  // Step A1: Create Trade or reuse existing pending Trade A
  let tradeAUuid = '';
  let tradeAPublicId = '';

  const { data: existingTradeA } = await adminSupabase
    .from('trades')
    .select('id, public_id, trade_id, status')
    .eq('id', 'cc02d3b7-b56e-4645-9a39-a5efd6cd36c2')
    .maybeSingle();

  if (existingTradeA && existingTradeA.status === 'pending') {
    tradeAUuid = existingTradeA.id;
    tradeAPublicId = existingTradeA.public_id || existingTradeA.trade_id;
    console.log(`\n[A.1] Reusing already initiated Trade A: UUID=${tradeAUuid}, PublicID=${tradeAPublicId}`);
  } else {
    console.log('\n[A.1] Buyer initiating 1.0 USDT trade with Seller...');
    const createTradeResA = await fetch(`${BASE_URL}/api/trades/initiate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${buyerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ad_id: AD_ID,
        crypto_amount: 1.0,
        fiat_amount: 1.0,
        price: 1.0,
        fiat_currency: 'USD',
        payment_method: 'Bank Transfer',
      }),
    });

    const createTradeDataA = await createTradeResA.json();
    console.log('  Trade A Creation HTTP Status:', createTradeResA.status);
    console.log('  Trade A Creation Body:', createTradeDataA);

    tradeAUuid = createTradeDataA.tradeId || createTradeDataA.id || createTradeDataA.trade_id || createTradeDataA.data?.trade_id;
    tradeAPublicId = createTradeDataA.publicId || createTradeDataA.public_id || createTradeDataA.trade_ref || createTradeDataA.data?.public_id;

    if (!createTradeResA.ok || !tradeAUuid) {
      throw new Error(`Failed to create Trade A: ${JSON.stringify(createTradeDataA)}`);
    }

    console.log(`  ✓ Trade A Created: UUID=${tradeAUuid}, PublicID=${tradeAPublicId}`);
  }

  // Verify Escrow Lock for Trade A
  const afterLockSellerSnapA = await getWalletSnapshot(SELLER_ID);
  const afterLockBuyerSnapA = await getWalletSnapshot(BUYER_ID);
  console.log('  Seller USDT after lock:', afterLockSellerSnapA);
  console.log('  Buyer USDT after lock:', afterLockBuyerSnapA);

  // Step A2: Mark Paid
  console.log('\n[A.2] Buyer marking Trade A as paid...');
  const markPaidResA = await fetch(`${BASE_URL}/api/trades/${tradeAUuid}/actions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${buyerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'MARK_AS_PAID' }),
  });
  const markPaidDataA = await markPaidResA.json();
  console.log('  Mark Paid HTTP Status:', markPaidResA.status, markPaidDataA);

  // Verify trade status = paid
  const { data: tradeAfterPaidA } = await adminSupabase
    .from('trades')
    .select('id, status, escrow_status, paid_at, marked_paid_at')
    .eq('id', tradeAUuid)
    .single();
  console.log('  Trade A after marked paid:', tradeAfterPaidA);

  // Step A3: Raise Dispute
  console.log('\n[A.3] Buyer opening official dispute on Trade A...');
  const raiseDisputeResA = await fetch(`${BASE_URL}/api/trades/${tradeAUuid}/dispute`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${buyerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Seller unresponsive after payment transferred' }),
  });
  const raiseDisputeDataA = await raiseDisputeResA.json();
  console.log('  Raise Dispute HTTP Status:', raiseDisputeResA.status, raiseDisputeDataA);

  // Query dispute record from database
  const { data: disputeRecA } = await adminSupabase
    .from('disputes')
    .select('*')
    .eq('trade_id', tradeAUuid)
    .single();
  console.log('  Dispute A DB Record:', disputeRecA);

  const { data: tradeAfterDisputeA } = await adminSupabase
    .from('trades')
    .select('id, status, escrow_status, disputed_at, dispute_reason')
    .eq('id', tradeAUuid)
    .single();
  console.log('  Trade A after dispute opened:', tradeAfterDisputeA);

  // Step A4: Moderator Awards Buyer
  console.log('\n[A.4] Moderator resolving dispute in favor of BUYER (RELEASE_TO_BUYER)...');
  const resolveResA = await fetch(`${BASE_URL}/api/admin/disputes/${tradeAUuid}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      resolution: 'RELEASE_TO_BUYER',
      notes: 'Valid proof of payment provided by Buyer. Moderator awarded trade to Buyer.',
    }),
  });
  const resolveDataA = await resolveResA.json();
  console.log('  Dispute A Resolution HTTP Status:', resolveResA.status, resolveDataA);

  // Step A5: Financial Verification for Trade A
  console.log('\n[A.5] Verifying balances after Buyer-win resolution...');
  const afterWinSellerSnapA = await getWalletSnapshot(SELLER_ID);
  const afterWinBuyerSnapA = await getWalletSnapshot(BUYER_ID);
  console.log('  Seller USDT after Buyer Win:', afterWinSellerSnapA);
  console.log('  Buyer USDT after Buyer Win:', afterWinBuyerSnapA);

  const { data: tradeAfterResolveA } = await adminSupabase
    .from('trades')
    .select('id, status, escrow_status, released_at, completed_at')
    .eq('id', tradeAUuid)
    .single();
  console.log('  Trade A after resolution:', tradeAfterResolveA);

  const { data: disputeAfterResolveA } = await adminSupabase
    .from('disputes')
    .select('*')
    .eq('trade_id', tradeAUuid)
    .single();
  console.log('  Dispute A after resolution:', disputeAfterResolveA);

  // Query Ledger entries for Trade A
  const { data: ledgersA } = await adminSupabase
    .from('ledger_entries')
    .select('*')
    .or(`reference_id.eq.${tradeAUuid},metadata->>trade_id.eq.${tradeAUuid}`)
    .order('created_at', { ascending: true });
  console.log(`  Ledger entries for Trade A (${ledgersA?.length} entries):`, ledgersA);

  // Step A6: Idempotency Test for Trade A
  console.log('\n[A.6] Testing Idempotency on Trade A (Re-executing resolution)...');
  const reResolveResA = await fetch(`${BASE_URL}/api/admin/disputes/${tradeAUuid}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      resolution: 'RELEASE_TO_BUYER',
      notes: 'Idempotency re-run',
    }),
  });
  const reResolveDataA = await reResolveResA.json();
  console.log('  Re-resolution HTTP Status:', reResolveResA.status, reResolveDataA);

  const reResolveSellerSnapA = await getWalletSnapshot(SELLER_ID);
  const reResolveBuyerSnapA = await getWalletSnapshot(BUYER_ID);
  console.log('  Seller USDT after re-resolution:', reResolveSellerSnapA);
  console.log('  Buyer USDT after re-resolution:', reResolveBuyerSnapA);

  // Notifications for Trade A
  const { data: notifsA } = await adminSupabase
    .from('notifications')
    .select('*')
    .or(`user_id.eq.${BUYER_ID},user_id.eq.${SELLER_ID}`)
    .order('created_at', { ascending: false })
    .limit(6);
  console.log('  Recent notifications after Trade A resolution:', notifsA);

  // =========================================================================
  // TEST B: SELLER-WIN DISPUTE RESOLUTION
  // =========================================================================
  console.log('\n-------------------------------------------------------------');
  console.log('  TEST B: SELLER-WIN DISPUTE WORKFLOW (MODERATOR AWARDS SELLER) ');
  console.log('-------------------------------------------------------------');

  // Step B1: Create Trade B
  console.log('\n[B.1] Buyer initiating second 1.0 USDT trade with Seller...');
  const createTradeResB = await fetch(`${BASE_URL}/api/trades/initiate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${buyerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ad_id: AD_ID,
      crypto_amount: 1.0,
      fiat_amount: 1.0,
      price: 1.0,
      fiat_currency: 'USD',
      payment_method: 'Bank Transfer',
    }),
  });

  const createTradeDataB = await createTradeResB.json();
  console.log('  Trade B Creation HTTP Status:', createTradeResB.status, createTradeDataB);

  const tradeBUuid = createTradeDataB.tradeId || createTradeDataB.id || createTradeDataB.trade_id || createTradeDataB.data?.trade_id;
  const tradeBPublicId = createTradeDataB.publicId || createTradeDataB.public_id || createTradeDataB.trade_ref || createTradeDataB.data?.public_id;

  if (!createTradeResB.ok || !tradeBUuid) {
    throw new Error(`Failed to create Trade B: ${JSON.stringify(createTradeDataB)}`);
  }

  console.log(`  ✓ Trade B Created: UUID=${tradeBUuid}, PublicID=${tradeBPublicId}`);

  // Verify Escrow Lock for Trade B
  const afterLockSellerSnapB = await getWalletSnapshot(SELLER_ID);
  const afterLockBuyerSnapB = await getWalletSnapshot(BUYER_ID);
  console.log('  Seller USDT after Trade B lock:', afterLockSellerSnapB);
  console.log('  Buyer USDT after Trade B lock:', afterLockBuyerSnapB);

  // Step B2: Mark Paid
  console.log('\n[B.2] Buyer marking Trade B as paid...');
  const markPaidResB = await fetch(`${BASE_URL}/api/trades/${tradeBUuid}/actions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${buyerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'MARK_AS_PAID' }),
  });
  const markPaidDataB = await markPaidResB.json();
  console.log('  Mark Paid HTTP Status:', markPaidResB.status, markPaidDataB);

  // Step B3: Raise Dispute (by Seller this time)
  console.log('\n[B.3] Seller opening official dispute on Trade B...');
  const raiseDisputeResB = await fetch(`${BASE_URL}/api/trades/${tradeBUuid}/dispute`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${sellerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason: 'Buyer marked paid but funds were never received' }),
  });
  const raiseDisputeDataB = await raiseDisputeResB.json();
  console.log('  Raise Dispute HTTP Status:', raiseDisputeResB.status, raiseDisputeDataB);

  // Query dispute record from database
  const { data: disputeRecB } = await adminSupabase
    .from('disputes')
    .select('*')
    .eq('trade_id', tradeBUuid)
    .single();
  console.log('  Dispute B DB Record:', disputeRecB);

  // Step B4: Moderator Awards Seller
  console.log('\n[B.4] Moderator resolving dispute in favor of SELLER (REFUND_TO_SELLER)...');
  const resolveResB = await fetch(`${BASE_URL}/api/admin/disputes/${tradeBUuid}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      resolution: 'REFUND_TO_SELLER',
      notes: 'No proof of payment found. Moderator awarded refund to Seller.',
    }),
  });
  const resolveDataB = await resolveResB.json();
  console.log('  Dispute B Resolution HTTP Status:', resolveResB.status, resolveDataB);

  // Step B5: Financial Verification for Trade B
  console.log('\n[B.5] Verifying balances after Seller-win resolution...');
  const afterWinSellerSnapB = await getWalletSnapshot(SELLER_ID);
  const afterWinBuyerSnapB = await getWalletSnapshot(BUYER_ID);
  console.log('  Seller USDT after Seller Win:', afterWinSellerSnapB);
  console.log('  Buyer USDT after Seller Win:', afterWinBuyerSnapB);

  const { data: tradeAfterResolveB } = await adminSupabase
    .from('trades')
    .select('id, status, escrow_status, cancelled_at')
    .eq('id', tradeBUuid)
    .single();
  console.log('  Trade B after resolution:', tradeAfterResolveB);

  const { data: disputeAfterResolveB } = await adminSupabase
    .from('disputes')
    .select('*')
    .eq('trade_id', tradeBUuid)
    .single();
  console.log('  Dispute B after resolution:', disputeAfterResolveB);

  // Query Ledger entries for Trade B
  const { data: ledgersB } = await adminSupabase
    .from('ledger_entries')
    .select('*')
    .or(`reference_id.eq.${tradeBUuid},metadata->>trade_id.eq.${tradeBUuid}`)
    .order('created_at', { ascending: true });
  console.log(`  Ledger entries for Trade B (${ledgersB?.length} entries):`, ledgersB);

  // Step B6: Idempotency Test for Trade B
  console.log('\n[B.6] Testing Idempotency on Trade B (Re-executing resolution)...');
  const reResolveResB = await fetch(`${BASE_URL}/api/admin/disputes/${tradeBUuid}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      resolution: 'REFUND_TO_SELLER',
      notes: 'Idempotency re-run',
    }),
  });
  const reResolveDataB = await reResolveResB.json();
  console.log('  Re-resolution B HTTP Status:', reResolveResB.status, reResolveDataB);

  const reResolveSellerSnapB = await getWalletSnapshot(SELLER_ID);
  const reResolveBuyerSnapB = await getWalletSnapshot(BUYER_ID);
  console.log('  Seller USDT after re-resolution B:', reResolveSellerSnapB);
  console.log('  Buyer USDT after re-resolution B:', reResolveBuyerSnapB);

  // =========================================================================
  // TEST C: AUTHORIZATION & SECURITY BOUNDARY TESTS
  // =========================================================================
  console.log('\n-------------------------------------------------------------');
  console.log('  TEST C: AUTHORIZATION & SECURITY BOUNDARY TESTS             ');
  console.log('-------------------------------------------------------------');

  // 1. Unauthenticated request
  const unauthRes = await fetch(`${BASE_URL}/api/admin/disputes/${tradeAUuid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolution: 'RELEASE_TO_BUYER' }),
  });
  console.log('  1. Unauthenticated resolution attempt HTTP:', unauthRes.status);

  // 2. Buyer resolving dispute as admin
  const buyerAsAdminRes = await fetch(`${BASE_URL}/api/admin/disputes/${tradeAUuid}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${buyerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resolution: 'RELEASE_TO_BUYER' }),
  });
  console.log('  2. Buyer resolving dispute attempt HTTP:', buyerAsAdminRes.status);

  // 3. Seller resolving dispute as admin
  const sellerAsAdminRes = await fetch(`${BASE_URL}/api/admin/disputes/${tradeAUuid}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${sellerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resolution: 'REFUND_TO_SELLER' }),
  });
  console.log('  3. Seller resolving dispute attempt HTTP:', sellerAsAdminRes.status);

  // 4. Ordinary user resolving dispute
  const ordinaryAsAdminRes = await fetch(`${BASE_URL}/api/admin/disputes/${tradeAUuid}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ordinaryToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resolution: 'RELEASE_TO_BUYER' }),
  });
  console.log('  4. Ordinary user resolving dispute attempt HTTP:', ordinaryAsAdminRes.status);

  // 5. Cross-trade non-existent trade ID
  const crossTradeRes = await fetch(`${BASE_URL}/api/admin/disputes/00000000-0000-0000-0000-000000000000`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resolution: 'RELEASE_TO_BUYER' }),
  });
  console.log('  5. Non-existent trade ID attempt HTTP:', crossTradeRes.status);

  // =========================================================================
  // TEST D: LEGACY ISOLATION & CLEANUP
  // =========================================================================
  console.log('\n-------------------------------------------------------------');
  console.log('  TEST D: LEGACY ISOLATION & FINAL FINANCIAL RECONCILIATION   ');
  console.log('-------------------------------------------------------------');

  const finalLegacy = await getLegacyCounts();
  console.log('  Initial Legacy Counts:', initialLegacy);
  console.log('  Final Legacy Counts:', finalLegacy);

  const finalSellerSnap = await getWalletSnapshot(SELLER_ID);
  const finalBuyerSnap = await getWalletSnapshot(BUYER_ID);

  console.log('\n  Final Seller USDT Balance:', finalSellerSnap.balance, '(in_escrow:', finalSellerSnap.in_escrow, ')');
  console.log('  Final Buyer USDT Balance:', finalBuyerSnap.balance, '(in_escrow:', finalBuyerSnap.in_escrow, ')');

  // Deactivate seller ad
  await fetch(`${BASE_URL}/api/ads/${AD_ID}/toggle`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${sellerToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ active: false, status: 'INACTIVE' }),
  });
  console.log('  ✓ Test ad deactivated.');

  console.log('\n===============================================================');
  console.log('  PART 10I AUDIT COMPLETED                                    ');
  console.log('===============================================================');
}

runPart10IAudit().catch((err) => {
  console.error('FATAL AUDIT ERROR:', err);
  process.exit(1);
});
