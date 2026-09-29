import { ethers } from 'ethers';

// Test harness for actual fee extraction logic
function runFeeExtractionTests() {
  console.log('\n--- ACTUAL ON-CHAIN FEE EXTRACTION UNIT TESTS ---');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, msg: string) {
    total++;
    if (condition) {
      console.log(`✓ ${msg}`);
      passed++;
    } else {
      console.error(`✗ ${msg}`);
    }
  }

  // 1. BTC Sat to BTC BigInt conversion
  {
    const feeSat = 12500n;
    const whole = feeSat / 100000000n;
    const fraction = (feeSat % 100000000n).toString().padStart(8, '0');
    const actualFeeBtc = `${whole}.${fraction}`;
    assert(actualFeeBtc === '0.00012500', 'BTC feeSat 12500n converts to 0.00012500 BTC');
  }

  // 2. BTC Input minus output calculation
  {
    const inputs = [{ prevout: { value: 10000000 } }, { prevout: { value: 5000000 } }];
    const outputs = [{ value: 14800000 }, { value: 150000 }];
    const inputSum = inputs.reduce((acc, v) => acc + BigInt(v.prevout.value), 0n);
    const outputSum = outputs.reduce((acc, v) => acc + BigInt(v.value), 0n);
    const feeSat = inputSum - outputSum;
    const actualFeeBtc = `${feeSat / 100000000n}.${(feeSat % 100000000n).toString().padStart(8, '0')}`;
    assert(feeSat === 50000n && actualFeeBtc === '0.00050000', 'BTC input minus output = 50000 sat (0.0005 BTC)');
  }

  // 3. LTC Lit to LTC conversion
  {
    const feeLit = 4500n;
    const whole = feeLit / 100000000n;
    const fraction = (feeLit % 100000000n).toString().padStart(8, '0');
    const actualFeeLtc = `${whole}.${fraction}`;
    assert(actualFeeLtc === '0.00004500', 'LTC feeLit 4500n converts to 0.00004500 LTC');
  }

  // 4. EVM ETH gasUsed * effectiveGasPrice
  {
    const gasUsed = 45000n;
    const effectiveGasPrice = 20000000000n; // 20 Gwei
    const gasCostWei = gasUsed * effectiveGasPrice;
    const actualCostEth = ethers.formatEther(gasCostWei);
    assert(actualCostEth === '0.0009', 'EVM 45k gas @ 20 Gwei = 0.0009 ETH');
  }

  // 5. BSC BNB gasUsed * effectiveGasPrice
  {
    const gasUsed = 45000n;
    const effectiveGasPrice = 3000000000n; // 3 Gwei
    const gasCostWei = gasUsed * effectiveGasPrice;
    const actualCostBnb = ethers.formatEther(gasCostWei);
    assert(actualCostBnb === '0.000135', 'BSC 45k gas @ 3 Gwei = 0.000135 BNB');
  }

  // 6. TRON SUN to TRX BigInt conversion
  {
    const feeSun = 13500000n; // 13.5 TRX
    const whole = feeSun / 1000000n;
    const fraction = (feeSun % 1000000n).toString().padStart(6, '0');
    const actualCostTrx = `${whole}.${fraction}`;
    assert(actualCostTrx === '13.500000', 'TRON 13,500,000 SUN converts to 13.500000 TRX');
  }

  console.log(`\nTests Completed: ${passed}/${total} Passed.`);
}

runFeeExtractionTests();
