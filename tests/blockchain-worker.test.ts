import { createClient } from '@supabase/supabase-js';
import { randomUUID, randomBytes } from 'node:crypto';
import { CANONICAL_USDT_CONTRACTS } from '../src/jobs/depositIngestion';

// SAFETY: This deposit integration test writes directly to wallet tables.
// It is restricted to a local disposable Supabase instance. Withdrawal broadcasting
// is intentionally excluded until the worker supports injected mock chain providers.
const supabaseUrl = process.env.TEST_SUPABASE_URL;
const supabaseKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const isLocalTestUrl = !!supabaseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(supabaseUrl);

if (
  process.env.NODE_ENV !== 'test' ||
  process.env.ALLOW_BLOCKCHAIN_INTEGRATION_TESTS !== 'true' ||
  !isLocalTestUrl ||
  !supabaseKey ||
  process.env.BLOCKCHAIN_TEST_MODE !== 'mock'
) {
  throw new Error(
    'Blocked unsafe blockchain deposit integration test. Use NODE_ENV=test, a local TEST_SUPABASE_URL, ' +
    'TEST_SUPABASE_SERVICE_ROLE_KEY, ALLOW_BLOCKCHAIN_INTEGRATION_TESTS=true, and ' +
    'BLOCKCHAIN_TEST_MODE=mock. Do not use production credentials or live chain providers.'
  );
}

const supabase = createClient(supabaseUrl!, supabaseKey, {
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
  const totalTests = 2;

  const testUserId = randomUUID();
  const testWalletId = randomUUID();
  const testDepositAddress = `0x${randomBytes(20).toString('hex')}`;

  try {
    // ------------------------------------------------------------------------
    // SETUP: Provision test wallet & registered deposit address
    // ------------------------------------------------------------------------
    console.log(cyan('[Setup] Registering test wallet & deposit address mapping...'));

    const { error: walletSetupError } = await supabase
      .from('wallets')
      .upsert({ id: testWalletId, user_id: testUserId }, { onConflict: 'id' });
    if (walletSetupError) throw new Error(`Unable to create test wallet: ${walletSetupError.message}`);

    const { error: assetSetupError } = await supabase.from('wallet_assets').upsert(
      {
        wallet_id: testWalletId,
        asset_code: 'USDT',
        available: 0.0,
        locked_escrow: 0.0,
        locked_withdrawal: 0.0,
      },
      { onConflict: 'wallet_id,asset_code' }
    );
    if (assetSetupError) throw new Error(`Unable to create test wallet asset: ${assetSetupError.message}`);

    // Register deposit address
    const { error: addressSetupError } = await supabase.from('deposit_addresses').upsert(
      {
        user_id: testUserId,
        wallet_id: testWalletId,
        address: testDepositAddress,
        network_code: 'BEP20',
        asset_code: 'USDT',
      },
      { onConflict: 'address' }
    );
    if (addressSetupError) throw new Error(`Unable to register test deposit address: ${addressSetupError.message}`);

    console.log(green('  ✓ Registered BEP20 deposit address\n'));

    // ------------------------------------------------------------------------
    // TEST 1: Inbound BEP-20 Deposit Ingestion & Atomic Credit
    // ------------------------------------------------------------------------
    console.log(bold('Test 1: BEP-20 Inbound Deposit Ingestion & Confirmation Check'));
    const testTxHash = `0x${randomBytes(32).toString('hex')}`;
    const testLogIndex = 1;
    const depositAmount = 250.0;
    const requiredConfirmations = 15; // BEP20 requires 15 confirmations

    const { data: ingestResult, error: ingestErr } = await supabase.rpc('process_deposit_atomic', {
      p_destination_address: testDepositAddress,
      p_asset_symbol: 'USDT',
      p_network_code: 'BEP20',
      p_amount: depositAmount,
      p_tx_hash: testTxHash,
      p_output_index: testLogIndex,
      p_block_number: 1000000,
      p_from_address: '0x3333333333333333333333333333333333333333',
      p_token_contract: CANONICAL_USDT_CONTRACTS.BEP20,
      p_confirmations: requiredConfirmations,
      p_provider: 'test_suite',
    });

    if (ingestErr) {
      console.log(red(`  ✗ Ingest RPC failed: ${ingestErr.message}`));
    } else {
      // Check that wallet was credited
      const { data: asset, error: assetReadError } = await supabase
        .from('wallet_assets')
        .select('available')
        .eq('wallet_id', testWalletId)
        .eq('asset_code', 'USDT')
        .single();
      if (assetReadError) throw new Error(`Unable to verify credited deposit balance: ${assetReadError.message}`);

      if (asset && Number(asset.available) === depositAmount) {
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
    console.log(bold('\nTest 2: Double-Spend Rejection on Duplicate (tx_hash, output_index)'));
    const { data: duplicateResult, error: dupErr } = await supabase.rpc('process_deposit_atomic', {
      p_destination_address: testDepositAddress,
      p_asset_symbol: 'USDT',
      p_network_code: 'BEP20',
      p_amount: depositAmount,
      p_tx_hash: testTxHash,
      p_output_index: testLogIndex,
      p_block_number: 1000000,
      p_from_address: '0x3333333333333333333333333333333333333333',
      p_token_contract: CANONICAL_USDT_CONTRACTS.BEP20,
      p_confirmations: requiredConfirmations,
      p_provider: 'test_suite',
    });

    if (dupErr) {
      console.log(red(`  ✗ Duplicate ingest check failed: ${dupErr.message}`));
    } else {
      const parsedDup = typeof duplicateResult === 'string' ? JSON.parse(duplicateResult) : duplicateResult;
      const isAlreadyProcessed = parsedDup?.already_processed === true;

      // Verify balance didn't double
      const { data: assetAfterDup, error: duplicateBalanceReadError } = await supabase
        .from('wallet_assets')
        .select('available')
        .eq('wallet_id', testWalletId)
        .eq('asset_code', 'USDT')
        .single();
      if (duplicateBalanceReadError) {
        throw new Error(`Unable to verify balance after duplicate deposit: ${duplicateBalanceReadError.message}`);
      }

      if (isAlreadyProcessed && Number(assetAfterDup?.available) === depositAmount) {
        console.log(green('  ✓ Duplicate transaction detected and rejected'));
        console.log(green(`  ✓ Balance remains protected at exactly ${assetAfterDup?.available} USDT`));
        passedTests++;
      } else {
        console.log(red(`  ✗ Double spend guard failed! Current balance: ${assetAfterDup?.available}`));
      }
    }

    // IMPORTANT: Withdrawal-worker broadcasting is intentionally excluded from this
    // integration suite. The worker currently uses real configured chain providers;
    // setting BLOCKCHAIN_TEST_MODE=mock alone does not inject a mock provider.
    // Test withdrawal queue/nonce/broadcast behavior only after dependency injection
    // provides a provably mocked signer/provider. Never broadcast from this suite.

  } catch (err: any) {
    console.error(red(`\nFatal error in blockchain worker tests: ${err.message}`));
  } finally {
    // Remove only records created for this run; preserve FK deletion order.
    const { error: addressCleanupError } = await supabase
      .from('deposit_addresses')
      .delete()
      .eq('address', testDepositAddress);
    const { error: assetCleanupError } = await supabase
      .from('wallet_assets')
      .delete()
      .eq('wallet_id', testWalletId);
    const { error: walletCleanupError } = await supabase
      .from('wallets')
      .delete()
      .eq('id', testWalletId);
    const cleanupError = addressCleanupError || assetCleanupError || walletCleanupError;
    if (cleanupError) {
      process.exitCode = 1;
      console.error(red(`Test fixture cleanup failed: ${cleanupError.message}`));
    }
    console.log(bold(cyan('\n------------------------------------------------------')));
    console.log(bold(`Results: ${passedTests}/${totalTests} tests passed.`));
    console.log(bold(cyan('------------------------------------------------------\n')));
    if (passedTests === totalTests) {
      console.log(green(bold('ALL BLOCKCHAIN DEPOSIT INTEGRATION TESTS PASSED!')));
    } else {
      process.exitCode = 1;
      console.log(red(bold('BLOCKCHAIN DEPOSIT INTEGRATION TESTS FAILED.')));
    }
  }
}

runBlockchainWorkerTests();
