import { createClient } from '@supabase/supabase-js';
import { processWithdrawalQueue } from '../src/jobs/withdrawalWorker';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Color helpers
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function runBlockchainWorkerTests() {
  console.log(bold(cyan('\n======================================================')));
  console.log(bold(cyan(' BLOCKCHAIN INGESTION & WITHDRAWAL WORKER TEST SUITE  ')));
  console.log(bold(cyan('======================================================\n')));

  let passedTests = 0;
  const totalTests = 4;

  const testUserId = '00000000-0000-0000-0000-000000000099';
  const testWalletId = '99999999-9999-9999-9999-999999999999';
  const testDepositAddress = '0x1111111111111111111111111111111111111111';

  try {
    // ------------------------------------------------------------------------
    // SETUP: Provision test wallet & registered deposit address
    // ------------------------------------------------------------------------
    console.log(cyan('[Setup] Registering test wallet & deposit address mapping...'));

    await supabase.from('wallets').upsert({ id: testWalletId, user_id: testUserId }, { onConflict: 'id' });

    await supabase.from('wallet_assets').upsert(
      {
        wallet_id: testWalletId,
        asset_code: 'USDT',
        available: 0.0,
        locked_escrow: 0.0,
        locked_withdrawal: 0.0,
      },
      { onConflict: 'wallet_id,asset_code' }
    );

    // Register deposit address
    await supabase.from('deposit_addresses').upsert(
      {
        user_id: testUserId,
        address: testDepositAddress,
        network_code: 'BEP20',
        asset_code: 'USDT',
      },
      { onConflict: 'address' }
    );

    console.log(green('  ✓ Registered BEP20 deposit address\n'));

    // ------------------------------------------------------------------------
    // TEST 1: Inbound BEP-20 Deposit Ingestion & Atomic Credit
    // ------------------------------------------------------------------------
    console.log(bold('Test 1: BEP-20 Inbound Deposit Ingestion & Confirmation Check'));
    const testTxHash = `0xbep20_${Date.now()}_test_tx`;
    const testLogIndex = 1;
    const depositAmount = 250.0;
    const requiredConfirmations = 15; // BEP20 requires 15 confirmations

    const { data: ingestResult, error: ingestErr } = await supabase.rpc('ingest_and_credit_deposit', {
      p_tx_hash: testTxHash,
      p_log_index: testLogIndex,
      p_network: 'BEP20',
      p_to_address: testDepositAddress,
      p_amount: depositAmount,
      p_asset_symbol: 'USDT',
      p_confirmations: requiredConfirmations,
    });

    if (ingestErr) {
      console.log(red(`  ✗ Ingest RPC failed: ${ingestErr.message}`));
    } else {
      // Check that wallet was credited
      const { data: asset } = await supabase
        .from('wallet_assets')
        .select('available')
        .eq('wallet_id', testWalletId)
        .eq('asset_code', 'USDT')
        .single();

      if (asset && Number(asset.available) >= depositAmount) {
        console.log(green(`  ✓ Deposit recognized with ${requiredConfirmations} confirmations`));
        console.log(green(`  ✓ User wallet credited: ${asset.available} USDT`));
        passedTests++;
      } else {
        console.log(red(`  ✗ Wallet available balance not credited. Found: ${asset?.available}`));
      }
    }

    // ------------------------------------------------------------------------
    // TEST 2: Idempotency & Double-Spend Prevention
    // ------------------------------------------------------------------------
    console.log(bold('\nTest 2: Double-Spend Rejection on Duplicate (tx_hash, log_index)'));
    const { data: duplicateResult, error: dupErr } = await supabase.rpc('ingest_and_credit_deposit', {
      p_tx_hash: testTxHash,
      p_log_index: testLogIndex,
      p_network: 'BEP20',
      p_to_address: testDepositAddress,
      p_amount: depositAmount,
      p_asset_symbol: 'USDT',
      p_confirmations: requiredConfirmations,
    });

    if (dupErr) {
      console.log(red(`  ✗ Duplicate ingest check failed: ${dupErr.message}`));
    } else {
      const isAlreadyProcessed =
        duplicateResult?.[0]?.already_processed === true ||
        duplicateResult?.already_processed === true;

      // Verify balance didn't double
      const { data: assetAfterDup } = await supabase
        .from('wallet_assets')
        .select('available')
        .eq('wallet_id', testWalletId)
        .eq('asset_code', 'USDT')
        .single();

      if (isAlreadyProcessed && Number(assetAfterDup?.available) === depositAmount) {
        console.log(green('  ✓ Duplicate transaction detected and rejected'));
        console.log(green(`  ✓ Balance remains protected at exactly ${assetAfterDup?.available} USDT`));
        passedTests++;
      } else {
        console.log(red(`  ✗ Double spend guard failed! Current balance: ${assetAfterDup?.available}`));
      }
    }

    // ------------------------------------------------------------------------
    // TEST 3: Outbound Withdrawal Queue & Nonce Allocation
    // ------------------------------------------------------------------------
    console.log(bold('\nTest 3: Outbound Withdrawal Queue Processing & Sequential Nonce'));
    // Lock 50 USDT for withdrawal
    await supabase.from('wallet_assets').update({
      available: 200.0,
      locked_withdrawal: 50.0,
    }).eq('wallet_id', testWalletId).eq('asset_code', 'USDT');

    const testWithdrawalId = '88888888-8888-8888-8888-888888888888';
    await supabase.from('onchain_withdrawals').upsert(
      {
        id: testWithdrawalId,
        user_id: testUserId,
        wallet_id: testWalletId,
        to_address: '0x2222222222222222222222222222222222222222',
        asset_symbol: 'USDT',
        amount: 50.0,
        network: 'BEP20',
        status: 'PENDING',
        created_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    // Run withdrawal processor
    const workerResult = await processWithdrawalQueue();

    if (!workerResult.processed) {
      console.log(red(`  ✗ Withdrawal queue did not process record: ${workerResult.error}`));
    } else {
      // Query state of withdrawal
      const { data: processedWithdrawal } = await supabase
        .from('onchain_withdrawals')
        .select('status, tx_hash, nonce')
        .eq('id', testWithdrawalId)
        .single();

      if (
        processedWithdrawal &&
        ['SUBMITTED', 'PROCESSING'].includes(processedWithdrawal.status) &&
        processedWithdrawal.tx_hash
      ) {
        console.log(green(`  ✓ Withdrawal claimed & broadcasted (tx: ${processedWithdrawal.tx_hash})`));
        console.log(green(`  ✓ Nonce allocated: ${processedWithdrawal.nonce}, status: ${processedWithdrawal.status}`));
        passedTests++;
      } else {
        console.log(red(`  ✗ Withdrawal state invalid: ${JSON.stringify(processedWithdrawal)}`));
      }
    }

    // ------------------------------------------------------------------------
    // TEST 4: On-chain Confirmation & Final Settlement
    // ------------------------------------------------------------------------
    console.log(bold('\nTest 4: Withdrawal Final Confirmation (complete_onchain_withdrawal)'));
    const { data: confirmResult, error: confirmErr } = await supabase.rpc('complete_onchain_withdrawal', {
      p_withdrawal_id: testWithdrawalId,
      p_tx_hash: '0xbep20_confirmed_tx_hash_123',
    });

    if (confirmErr) {
      console.log(red(`  ✗ complete_onchain_withdrawal failed: ${confirmErr.message}`));
    } else {
      const { data: confirmedAsset } = await supabase
        .from('wallet_assets')
        .select('available, locked_withdrawal')
        .eq('wallet_id', testWalletId)
        .eq('asset_code', 'USDT')
        .single();

      const { data: finalWithdrawal } = await supabase
        .from('onchain_withdrawals')
        .select('status')
        .eq('id', testWithdrawalId)
        .single();

      if (
        finalWithdrawal?.status === 'CONFIRMED' &&
        Number(confirmedAsset?.locked_withdrawal) === 0
      ) {
        console.log(green('  ✓ Withdrawal status marked CONFIRMED'));
        console.log(green(`  ✓ locked_withdrawal liability cleanly cleared to 0 (available: ${confirmedAsset?.available})`));
        passedTests++;
      } else {
        console.log(red(`  ✗ Final confirmation failed: ${JSON.stringify(confirmedAsset)}`));
      }
    }
  } catch (err: any) {
    console.error(red(`\nFatal error in blockchain worker tests: ${err.message}`));
  } finally {
    console.log(bold(cyan('\n------------------------------------------------------')));
    console.log(bold(`Results: ${passedTests}/${totalTests} tests passed.`));
    console.log(bold(cyan('------------------------------------------------------\n')));
    if (passedTests === totalTests) {
      console.log(green(bold('ALL BLOCKCHAIN INGESTION & WITHDRAWAL TESTS PASSED!')));
    }
  }
}

runBlockchainWorkerTests();
