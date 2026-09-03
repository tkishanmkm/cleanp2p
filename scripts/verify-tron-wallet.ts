import { TronWeb } from 'tronweb';
import fs from 'fs';

// Automatically load local environment variables if available
if (typeof process.loadEnvFile === 'function') {
  if (fs.existsSync('.env.local')) {
    try {
      process.loadEnvFile('.env.local');
    } catch (_) {}
  }
  if (fs.existsSync('.env')) {
    try {
      process.loadEnvFile('.env');
    } catch (_) {}
  }
}

async function verifyTronSetup() {
  console.log('🔍 Checking TRON Hot Wallet Configuration...\n');

  const privateKey =
    process.env.TRON_HOT_WALLET_PRIVATE_KEY ||
    process.env.HOT_WALLET_PRIVATE_KEY ||
    process.env.EVM_HOT_WALLET_PRIVATE_KEY;
  const expectedTronAddress = process.env.TRON_HOT_WALLET_ADDRESS;

  if (!privateKey) {
    console.error('❌ Error: HOT_WALLET_PRIVATE_KEY is missing in .env!');
    return;
  }

  // Initialize TronWeb provider
  const fullHost = process.env.TRON_RPC_URL || 'https://api.trongrid.io';
  const apiKey = process.env.TRONGRID_API_KEY;

  const tronWeb = new TronWeb({
    fullHost,
    headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : undefined,
    privateKey: privateKey.startsWith('0x') ? privateKey.slice(2) : privateKey,
  });

  // 1. Derive Base58 TRON Address
  const derivedAddress = tronWeb.defaultAddress.base58;
  console.log(`• Derived TRON Address: ${derivedAddress}`);

  if (expectedTronAddress && derivedAddress !== expectedTronAddress) {
    console.warn(`⚠️ Warning: Derived address (${derivedAddress}) does not match TRON_HOT_WALLET_ADDRESS in .env (${expectedTronAddress})!`);
  } else {
    console.log('✅ TRON Address derivation verified.');
  }

  // 2. Query Native TRX Gas Balance
  try {
    const balanceSun = await (tronWeb.trx.getBalance(derivedAddress as string) as Promise<number>);
    const balanceTrx = balanceSun / 1_000_000;
    console.log(`• TRON Hot Wallet Native TRX Balance: ${balanceTrx} TRX`);

    if (balanceTrx < 30) {
      console.warn('⚠️ WARNING: Low TRX gas balance! TRC20 sweeps/dispatches require ~30–60 TRX per transfer if energy is not rented.');
    } else {
      console.log('✅ TRX Gas balance is sufficient for active dispatches.');
    }
  } catch (err: any) {
    console.error('❌ Failed connecting to TRON RPC endpoint:', err.message);
  }

  // 3. Check TRC20 USDT Balance
  try {
    let usdtContractAddress = process.env.TRON_USDT_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // Mainnet TRC20 USDT (lowercase 'je' for valid Base58 checksum)
    if (usdtContractAddress === 'TR7NHqJEKQxGTCi8q8ZY4pL8otSzgjLj6t') {
      usdtContractAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    }
    const contract = await (tronWeb.contract() as any).at(usdtContractAddress);
    const rawUsdtBalance = await contract.balanceOf(derivedAddress).call();
    const usdtBalance = Number(rawUsdtBalance) / 1_000_000;

    console.log(`• On-Chain TRC20 USDT Balance: ${usdtBalance.toFixed(2)} USDT`);
    console.log('\n🎉 TRON Hot Wallet integration check complete!');
  } catch (err: any) {
    console.error('❌ Failed querying TRC20 USDT contract:', err.message);
  }
}

verifyTronSetup().catch(console.error);
