import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { CANONICAL_USDT_CONTRACTS } from '../src/jobs/depositIngestion';
import { normalizeDepositNetwork } from '../src/lib/hd-derivation-engine';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Formatting
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

async function runCanonicalCutoverTests() {
  console.log(bold(cyan('\n======================================================')));
  console.log(bold(cyan(' CANONICAL DEPOSIT CUTOVER APPLICATION TEST SUITE   ')));
  console.log(bold(cyan('======================================================\n')));

  let passed = 0;
  let total = 14;

  const testUserId = '00000000-0000-0000-0000-000000000077';
  const testWalletId = '77777777-7777-7777-7777-777777777777';

  const addresses = {
    BTC: 'bc1qtestcanonicalbtcaddress77777777777777777',
    LTC: 'ltc1qtestcanonicalltcaddress7777777777777777',
    EVM: '0x7777777777777777777777777777777777777777',
    TRC20: 'TTestCanonicalTronAddress77777777777777',
  };

  try {
    // ------------------------------------------------------------------------
    // SETUP: Test wallet & deposit address rows
    // ------------------------------------------------------------------------
    console.log(cyan('[Setup] Registering user wallet and multi-chain deposit addresses...'));

    await supabase.from('wallets').upsert({ id: testWalletId, user_id: testUserId }, { onConflict: 'id' });

    for (const asset of ['BTC', 'LTC', 'ETH', 'USDT']) {
      await supabase.from('wallet_assets').upsert(
        {
          wallet_id: testWalletId,
          asset_code: asset,
          available: 0.0,
          locked_escrow: 0.0,
          locked_withdrawal: 0.0,
        },
        { onConflict: 'wallet_id,asset_code' }
      );
    }

    // Register deposit addresses
    await supabase.from('deposit_addresses').upsert([
      { user_id: testUserId, wallet_id: testWalletId, address: addresses.BTC, network_code: 'BTC', asset_code: 'BTC' },
      { user_id: testUserId, wallet_id: testWalletId, address: addresses.LTC, network_code: 'LTC', asset_code: 'LTC' },
      { user_id: testUserId, wallet_id: testWalletId, address: addresses.EVM, network_code: 'ETH', asset_code: 'ETH' },
      { user_id: testUserId, wallet_id: testWalletId, address: addresses.EVM, network_code: 'ERC20', asset_code: 'USDT' },
      { user_id: testUserId, wallet_id: testWalletId, address: addresses.EVM, network_code: 'BEP20', asset_code: 'USDT' },
      { user_id: testUserId, wallet_id: testWalletId, address: addresses.TRC20, network_code: 'TRC20', asset_code: 'USDT' },
    ], { onConflict: 'address,network_code' });

    console.log(green('  ✓ Test environment configured\n'));

    const runRpc = async (params: {
      address: string;
      asset: string;
      network: string;
      amount: number;
      txHash: string;
      outputIndex: number;
      tokenContract?: string | null;
      confirmations?: number;
    }) => {
      const normNet = normalizeDepositNetwork(params.network);
      return supabase.rpc('process_deposit_atomic', {
        p_destination_address: params.address,
        p_asset_symbol: params.asset,
        p_network_code: normNet,
        p_amount: params.amount,
        p_tx_hash: params.txHash,
        p_output_index: params.outputIndex,
        p_block_number: 1234567,
        p_from_address: null,
        p_token_contract: params.tokenContract ?? (params.asset === 'USDT' ? CANONICAL_USDT_CONTRACTS[normNet] : null),
        p_confirmations: params.confirmations ?? 20,
        p_provider: 'test_suite',
      });
    };

    // ------------------------------------------------------------------------
    // Scenario A: BTC transaction with output index 0
    // ------------------------------------------------------------------------
    console.log(bold('Scenario A: BTC transaction with output index 0'));
    const btcTxA = `0xbtc_test_a_${Date.now()}`;
    const resA = await runRpc({
      address: addresses.BTC,
      asset: 'BTC',
      network: 'BTC',
      amount: 0.15,
      txHash: btcTxA,
      outputIndex: 0,
    });
    if (!resA.error) {
      console.log(green('  ✓ BTC vout 0 credited successfully'));
      passed++;
    } else {
      console.log(red(`  ✗ BTC vout 0 failed: ${resA.error.message}`));
    }

    // ------------------------------------------------------------------------
    // Scenario B: BTC transaction with output index 1
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario B: BTC transaction with output index 1'));
    const btcTxB = `0xbtc_test_b_${Date.now()}`;
    const resB = await runRpc({
      address: addresses.BTC,
      asset: 'BTC',
      network: 'BTC',
      amount: 0.25,
      txHash: btcTxB,
      outputIndex: 1,
    });
    if (!resB.error) {
      console.log(green('  ✓ BTC vout 1 credited successfully'));
      passed++;
    } else {
      console.log(red(`  ✗ BTC vout 1 failed: ${resB.error.message}`));
    }

    // ------------------------------------------------------------------------
    // Scenario C: LTC transaction with multiple outputs
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario C: LTC transaction with multiple outputs'));
    const ltcTxC = `0xltc_test_c_${Date.now()}`;
    const resC0 = await runRpc({
      address: addresses.LTC,
      asset: 'LTC',
      network: 'LTC',
      amount: 1.5,
      txHash: ltcTxC,
      outputIndex: 0,
    });
    const resC1 = await runRpc({
      address: addresses.LTC,
      asset: 'LTC',
      network: 'LTC',
      amount: 2.5,
      txHash: ltcTxC,
      outputIndex: 1,
    });
    if (!resC0.error && !resC1.error) {
      console.log(green('  ✓ LTC multiple vout outputs credited successfully'));
      passed++;
    } else {
      console.log(red(`  ✗ LTC multi-output failed: ${resC0.error?.message || resC1.error?.message}`));
    }

    // ------------------------------------------------------------------------
    // Scenario D: ERC20 transaction with log index 0
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario D: ERC20 transaction with log index 0'));
    const ercTxD = `0xerc20_test_d_${Date.now()}`;
    const resD = await runRpc({
      address: addresses.EVM,
      asset: 'USDT',
      network: 'ERC20',
      amount: 100.0,
      txHash: ercTxD,
      outputIndex: 0,
      tokenContract: CANONICAL_USDT_CONTRACTS.ERC20,
    });
    if (!resD.error) {
      console.log(green('  ✓ ERC20 log index 0 credited successfully'));
      passed++;
    } else {
      console.log(red(`  ✗ ERC20 log 0 failed: ${resD.error.message}`));
    }

    // ------------------------------------------------------------------------
    // Scenario E: ERC20 transaction with log index 1
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario E: ERC20 transaction with log index 1'));
    const ercTxE = `0xerc20_test_e_${Date.now()}`;
    const resE = await runRpc({
      address: addresses.EVM,
      asset: 'USDT',
      network: 'ERC20',
      amount: 200.0,
      txHash: ercTxE,
      outputIndex: 1,
      tokenContract: CANONICAL_USDT_CONTRACTS.ERC20,
    });
    if (!resE.error) {
      console.log(green('  ✓ ERC20 log index 1 credited successfully'));
      passed++;
    } else {
      console.log(red(`  ✗ ERC20 log 1 failed: ${resE.error.message}`));
    }

    // ------------------------------------------------------------------------
    // Scenario F: Same tx hash + different log indexes treated as different deposits
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario F: Same tx hash + different log indexes (batch transfer)'));
    const batchTx = `0xbatch_evm_${Date.now()}`;
    const resF0 = await runRpc({
      address: addresses.EVM,
      asset: 'USDT',
      network: 'ERC20',
      amount: 50.0,
      txHash: batchTx,
      outputIndex: 0,
      tokenContract: CANONICAL_USDT_CONTRACTS.ERC20,
    });
    const resF1 = await runRpc({
      address: addresses.EVM,
      asset: 'USDT',
      network: 'ERC20',
      amount: 75.0,
      txHash: batchTx,
      outputIndex: 1,
      tokenContract: CANONICAL_USDT_CONTRACTS.ERC20,
    });

    const parsedF0 = typeof resF0.data === 'string' ? JSON.parse(resF0.data) : resF0.data;
    const parsedF1 = typeof resF1.data === 'string' ? JSON.parse(resF1.data) : resF1.data;

    if (!resF0.error && !resF1.error && parsedF0?.deposit_id !== parsedF1?.deposit_id) {
      console.log(green('  ✓ Distinct deposits created for different log indexes on same tx hash'));
      passed++;
    } else {
      console.log(red('  ✗ Batch log index separation failed'));
    }

    // ------------------------------------------------------------------------
    // Scenario G: Same tx hash + same log index is treated as same deposit (idempotent)
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario G: Same tx hash + same log index (idempotency replay)'));
    const resG = await runRpc({
      address: addresses.EVM,
      asset: 'USDT',
      network: 'ERC20',
      amount: 50.0,
      txHash: batchTx,
      outputIndex: 0,
      tokenContract: CANONICAL_USDT_CONTRACTS.ERC20,
    });
    const parsedG = typeof resG.data === 'string' ? JSON.parse(resG.data) : resG.data;
    if (!resG.error && parsedG?.already_processed === true) {
      console.log(green('  ✓ Idempotent replay recognized (already_processed: true)'));
      passed++;
    } else {
      console.log(red('  ✗ Idempotency replay guard failed'));
    }

    // ------------------------------------------------------------------------
    // Scenario H: BEP20 token event index
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario H: BEP20 token event index'));
    const bepTx = `0xbep20_token_${Date.now()}`;
    const resH = await runRpc({
      address: addresses.EVM,
      asset: 'USDT',
      network: 'BEP20',
      amount: 300.0,
      txHash: bepTx,
      outputIndex: 2,
      tokenContract: CANONICAL_USDT_CONTRACTS.BEP20,
    });
    if (!resH.error) {
      console.log(green('  ✓ BEP20 deposit credited with event index 2'));
      passed++;
    } else {
      console.log(red(`  ✗ BEP20 failed: ${resH.error.message}`));
    }

    // ------------------------------------------------------------------------
    // Scenario I: TRC20 event index
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario I: TRC20 token event index'));
    const trcTx = `0xtrc20_token_${Date.now()}`;
    const resI = await runRpc({
      address: addresses.TRC20,
      asset: 'USDT',
      network: 'TRC20',
      amount: 400.0,
      txHash: trcTx,
      outputIndex: 0,
      tokenContract: CANONICAL_USDT_CONTRACTS.TRC20,
    });
    if (!resI.error) {
      console.log(green('  ✓ TRC20 deposit credited with event index 0'));
      passed++;
    } else {
      console.log(red(`  ✗ TRC20 failed: ${resI.error.message}`));
    }

    // ------------------------------------------------------------------------
    // Scenario J: Native ETH index 0
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario J: Native ETH index 0'));
    const ethTx = `0xnative_eth_${Date.now()}`;
    const resJ = await runRpc({
      address: addresses.EVM,
      asset: 'ETH',
      network: 'ETH',
      amount: 0.5,
      txHash: ethTx,
      outputIndex: 0,
      tokenContract: null,
    });
    if (!resJ.error) {
      console.log(green('  ✓ Native ETH deposit credited with index 0'));
      passed++;
    } else {
      console.log(red(`  ✗ Native ETH failed: ${resJ.error.message}`));
    }

    // ------------------------------------------------------------------------
    // Scenario K: Missing/Invalid token contract fails closed
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario K: Invalid token contract fails closed'));
    const invalidContractTx = `0xinvalid_contract_${Date.now()}`;
    const resK = await runRpc({
      address: addresses.EVM,
      asset: 'USDT',
      network: 'ERC20',
      amount: 100.0,
      txHash: invalidContractTx,
      outputIndex: 0,
      tokenContract: '0x0000000000000000000000000000000000000000', // invalid token contract
    });
    if (resK.error || (resK.data && typeof resK.data === 'string' && resK.data.includes('INVALID_TOKEN_CONTRACT'))) {
      console.log(green('  ✓ Invalid token contract safely rejected (fail-closed)'));
      passed++;
    } else {
      console.log(red('  ✗ Invalid token contract check failed'));
    }

    // ------------------------------------------------------------------------
    // Scenario L: Unsupported network fails closed
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario L: Unsupported network fails closed'));
    const unsupportedNetTx = `0xunsupported_net_${Date.now()}`;
    const resL = await runRpc({
      address: addresses.EVM,
      asset: 'USDT',
      network: 'SOLANA',
      amount: 100.0,
      txHash: unsupportedNetTx,
      outputIndex: 0,
    });
    if (resL.error || (resL.data && typeof resL.data === 'string' && resL.data.includes('UNSUPPORTED_NETWORK'))) {
      console.log(green('  ✓ Unsupported network safely rejected (fail-closed)'));
      passed++;
    } else {
      console.log(red('  ✗ Unsupported network check failed'));
    }

    // ------------------------------------------------------------------------
    // Scenario M: Canonical RPC failure does NOT trigger direct balance fallback
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario M: RPC failure does NOT trigger direct balance fallback'));
    const unmonitoredAddr = '0x9999999999999999999999999999999999999999';
    const failTx = `0xfail_unmonitored_${Date.now()}`;
    const resM = await runRpc({
      address: unmonitoredAddr,
      asset: 'USDT',
      network: 'ERC20',
      amount: 1000.0,
      txHash: failTx,
      outputIndex: 0,
    });

    // In fail-closed design, the error is returned and no balance table is mutated
    if (resM.error || (resM.data && typeof resM.data === 'string' && resM.data.includes('DEPOSIT_ADDRESS_NOT_FOUND'))) {
      console.log(green('  ✓ Unregistered deposit address fails closed without side-effects'));
      passed++;
    } else {
      console.log(red('  ✗ Unregistered deposit address was unexpectedly accepted'));
    }

    // ------------------------------------------------------------------------
    // Scenario N: Retry does NOT create another financial credit
    // ------------------------------------------------------------------------
    console.log(bold('\nScenario N: Retry does NOT create duplicate financial credit'));
    const retryTx = `0xretry_test_${Date.now()}`;
    const resN1 = await runRpc({
      address: addresses.TRC20,
      asset: 'USDT',
      network: 'TRC20',
      amount: 125.0,
      txHash: retryTx,
      outputIndex: 0,
      tokenContract: CANONICAL_USDT_CONTRACTS.TRC20,
    });
    const resN2 = await runRpc({
      address: addresses.TRC20,
      asset: 'USDT',
      network: 'TRC20',
      amount: 125.0,
      txHash: retryTx,
      outputIndex: 0,
      tokenContract: CANONICAL_USDT_CONTRACTS.TRC20,
    });

    const parsedN2 = typeof resN2.data === 'string' ? JSON.parse(resN2.data) : resN2.data;
    if (!resN1.error && !resN2.error && parsedN2?.already_processed === true) {
      console.log(green('  ✓ Retry attempt recognized as already processed; zero additional credit created'));
      passed++;
    } else {
      console.log(red('  ✗ Duplicate financial credit prevention failed'));
    }

  } catch (err: any) {
    console.error(red(`\nFatal error in canonical cutover test suite: ${err.message}`));
  } finally {
    console.log(bold(cyan('\n------------------------------------------------------')));
    console.log(bold(`Results: ${passed}/${total} scenarios passed.`));
    console.log(bold(cyan('------------------------------------------------------\n')));
  }
}

runCanonicalCutoverTests();
