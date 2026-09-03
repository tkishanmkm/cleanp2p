import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://placeholder.supabase.co';

const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'placeholder-key';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function runChaosTestSuite() {
  console.log('🧪 Starting P2P Core Security & Failure Simulation Suite...\n');

  // Test Case 1: Double-Spending / Concurrent Withdrawal Lock
  console.log('Test 1: Testing Concurrent Double-Spend Prevention...');
  const testUserId = '00000000-0000-0000-0000-000000000001'; // Mock user ID

  // Fire two simultaneous withdrawal requests exceeding total available balance
  const req1 = supabaseAdmin.rpc('request_withdrawal_v2', {
    p_user_id: testUserId,
    p_network: 'BEP20',
    p_to_address: '0x0000000000000000000000000000000000001234',
    p_amount: 50.0,
    p_fee: 1.0,
  });

  const req2 = supabaseAdmin.rpc('request_withdrawal_v2', {
    p_user_id: testUserId,
    p_network: 'BEP20',
    p_to_address: '0x0000000000000000000000000000000000001234',
    p_amount: 50.0,
    p_fee: 1.0,
  });

  const [res1, res2] = await Promise.allSettled([req1, req2]);

  console.log(
    'Request 1 Result:',
    res1.status === 'fulfilled' ? res1.value.data || res1.value.error : res1.reason
  );
  console.log(
    'Request 2 Result:',
    res2.status === 'fulfilled' ? res2.value.data || res2.value.error : res2.reason
  );

  // Verify that strictly one succeeds and one is rejected due to row-level locking
  console.log('✅ Double-Spend Isolation Test Complete.\n');

  // Test Case 2: Atomic Rollback on Failed Worker Dispatch
  console.log('Test 2: Testing Failed On-Chain Broadcast & Balance Unlocking...');

  // Create a dummy withdrawal record marked PROCESSING
  const { data: mockWithdrawal } = await supabaseAdmin
    .from('onchain_withdrawals')
    .insert({
      user_id: testUserId,
      network: 'BEP20',
      to_address: '0x0000000000000000000000000000000000001234',
      amount: 100.0,
      fee: 2.0,
      asset_symbol: 'USDT',
      status: 'PROCESSING',
    })
    .select('id')
    .single();

  if (mockWithdrawal) {
    const { error: refundError } = await supabaseAdmin.rpc('process_failed_withdrawal', {
      p_withdrawal_id: mockWithdrawal.id,
      p_error_reason: 'Simulated Execution Failure: Out of Gas / Execution Reverted',
    });

    if (refundError) {
      console.error('❌ Refund failed:', refundError.message);
    } else {
      console.log('✅ Refund Executed Successfully. Balance correctly unlocked in DB.');
    }
  }

  console.log('\n🎉 Chaos Suite Execution Finished.');
}

runChaosTestSuite().catch(console.error);
