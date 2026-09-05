import { createClient } from '@supabase/supabase-js';

// Initialize Supabase admin client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Color helpers for clean terminal reporting
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function runP2PTradeFlowTests() {
  console.log(bold(cyan('\n======================================================')));
  console.log(bold(cyan('  P2P ESCROW & STATE MACHINE INTEGRATION TEST SUITE   ')));
  console.log(bold(cyan('======================================================\n')));

  let passedTests = 0;
  let totalTests = 4;

  const testSellerId = '00000000-0000-0000-0000-000000000001';
  const testBuyerId = '00000000-0000-0000-0000-000000000002';
  const testAdminId = '00000000-0000-0000-0000-000000000003';

  try {
    // ------------------------------------------------------------------------
    // SETUP: Ensure wallets and seed balance
    // ------------------------------------------------------------------------
    console.log(cyan('[Setup] Initializing test wallets & ledger state...'));

    // Create or get seller wallet
    const { data: sellerWallet } = await supabase
      .from('wallets')
      .upsert({ id: '11111111-1111-1111-1111-111111111111', user_id: testSellerId }, { onConflict: 'id' })
      .select()
      .single();

    // Create or get buyer wallet
    const { data: buyerWallet } = await supabase
      .from('wallets')
      .upsert({ id: '22222222-2222-2222-2222-222222222222', user_id: testBuyerId }, { onConflict: 'id' })
      .select()
      .single();

    const sellerWalletId = sellerWallet?.id || '11111111-1111-1111-1111-111111111111';
    const buyerWalletId = buyerWallet?.id || '22222222-2222-2222-2222-222222222222';

    // Seed seller with 500 USDT available balance
    await supabase.from('wallet_assets').upsert(
      {
        wallet_id: sellerWalletId,
        asset_code: 'USDT',
        available: 500.0,
        locked_escrow: 0.0,
        locked_withdrawal: 0.0,
      },
      { onConflict: 'wallet_id,asset_code' }
    );

    // Ensure buyer has asset entry
    await supabase.from('wallet_assets').upsert(
      {
        wallet_id: buyerWalletId,
        asset_code: 'USDT',
        available: 0.0,
        locked_escrow: 0.0,
        locked_withdrawal: 0.0,
      },
      { onConflict: 'wallet_id,asset_code' }
    );

    // Create a test Sell Ad
    const testAdId = '33333333-3333-3333-3333-333333333333';
    await supabase.from('ads').upsert(
      {
        id: testAdId,
        user_id: testSellerId,
        type: 'sell',
        asset: 'USDT',
        fiat_currency: 'USD',
        price_type: 'fixed',
        fixed_price: 1.0,
        min_amount: 10,
        max_amount: 500,
        available_crypto: 500.0,
        total_crypto: 500.0,
        status: 'active',
        payment_methods: ['Bank Transfer', 'Zelle'],
      },
      { onConflict: 'id' }
    );

    console.log(green('  ✓ Seeded wallets and active P2P advertisement\n'));

    // ------------------------------------------------------------------------
    // TEST 1: Buyer initiates order (initiate_p2p_trade)
    // ------------------------------------------------------------------------
    console.log(bold('Test 1: Buyer Initiates Order & Atomic Escrow Lock'));
    const tradeCryptoAmount = 100.0;
    const tradeFiatAmount = 100.0;

    const { data: tradeResult, error: tradeErr } = await supabase.rpc('initiate_p2p_trade', {
      p_ad_id: testAdId,
      p_buyer_id: testBuyerId,
      p_crypto_amount: tradeCryptoAmount,
      p_fiat_amount: tradeFiatAmount,
    });

    if (tradeErr) {
      console.log(red(`  ✗ initiate_p2p_trade RPC failed: ${tradeErr.message}`));
    } else {
      const tradeId = tradeResult;

      // Verify seller funds locked
      const { data: sellerAsset } = await supabase
        .from('wallet_assets')
        .select('available, locked_escrow')
        .eq('wallet_id', sellerWalletId)
        .eq('asset_code', 'USDT')
        .single();

      if (sellerAsset && Number(sellerAsset.locked_escrow) >= 100) {
        console.log(green(`  ✓ Order created (${tradeId})`));
        console.log(green(`  ✓ Seller available: ${sellerAsset.available}, locked_escrow: ${sellerAsset.locked_escrow}`));
        passedTests++;
      } else {
        console.log(red(`  ✗ Seller escrow was not locked properly: ${JSON.stringify(sellerAsset)}`));
      }

      // ------------------------------------------------------------------------
      // TEST 2: Buyer marks trade as paid (mark_trade_paid)
      // ------------------------------------------------------------------------
      console.log(bold('\nTest 2: Buyer Marks Trade as Paid'));
      const { data: payResult, error: payErr } = await supabase.rpc('mark_trade_paid', {
        p_trade_id: tradeId,
        p_buyer_id: testBuyerId,
      });

      if (payErr) {
        console.log(red(`  ✗ mark_trade_paid RPC failed: ${payErr.message}`));
      } else {
        // Verify trade status transitioned to PAID
        const { data: updatedTrade } = await supabase
          .from('trades')
          .select('status')
          .eq('id', tradeId)
          .single();

        if (updatedTrade?.status === 'PAID') {
          console.log(green('  ✓ Trade successfully transitioned to status PAID'));
          passedTests++;
        } else {
          console.log(red(`  ✗ Expected status PAID, received: ${updatedTrade?.status}`));
        }

        // ------------------------------------------------------------------------
        // TEST 3: Seller releases escrow (release_trade_escrow)
        // ------------------------------------------------------------------------
        console.log(bold('\nTest 3: Seller Releases Escrow & Credits Buyer'));
        const { data: releaseResult, error: releaseErr } = await supabase.rpc('release_trade_escrow', {
          p_trade_id: tradeId,
          p_seller_id: testSellerId,
        });

        if (releaseErr) {
          console.log(red(`  ✗ release_trade_escrow failed: ${releaseErr.message}`));
        } else {
          // Verify buyer received funds
          const { data: buyerAsset } = await supabase
            .from('wallet_assets')
            .select('available')
            .eq('wallet_id', buyerWalletId)
            .eq('asset_code', 'USDT')
            .single();

          const { data: finishedTrade } = await supabase
            .from('trades')
            .select('status')
            .eq('id', tradeId)
            .single();

          if (finishedTrade?.status === 'RELEASED' && Number(buyerAsset?.available) >= 100) {
            console.log(green('  ✓ Trade status marked RELEASED'));
            console.log(green(`  ✓ Buyer available credited: ${buyerAsset?.available} USDT`));
            passedTests++;
          } else {
            console.log(red(`  ✗ Buyer not credited or status incorrect. Trade status: ${finishedTrade?.status}`));
          }
        }
      }
    }

    // ------------------------------------------------------------------------
    // TEST 4: Dispute Flow & Administrative Resolution
    // ------------------------------------------------------------------------
    console.log(bold('\nTest 4: Dispute Elevation & Administrative Refund'));
    // 1. Create a second trade for dispute test
    const { data: disputeTradeId, error: dtErr } = await supabase.rpc('initiate_p2p_trade', {
      p_ad_id: testAdId,
      p_buyer_id: testBuyerId,
      p_crypto_amount: 50.0,
      p_fiat_amount: 50.0,
    });

    if (dtErr) {
      console.log(red(`  ✗ Failed initiating trade for dispute: ${dtErr.message}`));
    } else {
      // Buyer raises dispute
      const { error: disputeErr } = await supabase.rpc('raise_trade_dispute', {
        p_trade_id: disputeTradeId,
        p_initiator_id: testBuyerId,
        p_reason: 'Seller unresponsive after payment confirmation',
      });

      if (disputeErr) {
        console.log(red(`  ✗ raise_trade_dispute failed: ${disputeErr.message}`));
      } else {
        console.log(green('  ✓ Dispute successfully elevated'));

        // Admin resolves trade: REFUND_TO_SELLER
        const { error: resolveErr } = await supabase.rpc('admin_resolve_trade', {
          p_trade_id: disputeTradeId,
          p_admin_id: testAdminId,
          p_resolution_action: 'REFUND_TO_SELLER',
          p_admin_notes: 'Buyer failed to provide valid proof of payment receipt.',
        });

        if (resolveErr) {
          console.log(red(`  ✗ admin_resolve_trade failed: ${resolveErr.message}`));
        } else {
          const { data: resolvedTrade } = await supabase
            .from('trades')
            .select('status')
            .eq('id', disputeTradeId)
            .single();

          if (resolvedTrade?.status === 'RESOLVED' || resolvedTrade?.status === 'CANCELLED') {
            console.log(green(`  ✓ Dispute resolved by admin, trade marked: ${resolvedTrade.status}`));
            passedTests++;
          } else {
            console.log(red(`  ✗ Unexpected resolved trade status: ${resolvedTrade?.status}`));
          }
        }
      }
    }
  } catch (err: any) {
    console.error(red(`\nFatal error executing P2P tests: ${err.message}`));
  } finally {
    console.log(bold(cyan('\n------------------------------------------------------')));
    console.log(bold(`Results: ${passedTests}/${totalTests} tests passed.`));
    console.log(bold(cyan('------------------------------------------------------\n')));
    if (passedTests === totalTests) {
      console.log(green(bold('ALL P2P ESCROW STATE MACHINE TESTS PASSED SUCCESSFULLY!')));
    }
  }
}

runP2PTradeFlowTests();
