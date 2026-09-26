import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: '.env.local' });
import { JsonRpcProvider, formatEther } from 'ethers';

const rpcUrl = process.env.ETH_SEPOLIA_RPC_URL || 'https://rpc.ankr.com/eth_sepolia';
const targetTx = '0xe42aa14a65e5139e3a31f66d1e7f19629e20363105220a4c6a1d6cd5a80c50b9';
const expectedDestination = '0x86922005c916012046FeeaF4e4DB5365bed99540';

async function verifyTx() {
  console.log('=== VERIFYING ON-CHAIN TRANSACTION ===');
  console.log('RPC URL:', rpcUrl);
  
  const provider = new JsonRpcProvider(rpcUrl);
  const tx = await provider.getTransaction(targetTx);
  
  if (!tx) {
    console.error('Transaction not found on Sepolia!');
    return;
  }
  
  const receipt = await provider.getTransactionReceipt(targetTx);
  if (!receipt) {
    console.error('Transaction receipt not found!');
    return;
  }
  
  const currentBlock = await provider.getBlockNumber();
  const confirmations = tx.blockNumber ? (currentBlock - tx.blockNumber + 1) : 0;
  
  console.log('On-chain Transaction Properties:');
  console.log('- Hash:', tx.hash);
  console.log('- Block Number:', tx.blockNumber);
  console.log('- Confirmations:', confirmations);
  console.log('- From:', tx.from);
  console.log('- To:', tx.to);
  console.log('- Value:', formatEther(tx.value), 'ETH');
  console.log('- Status:', receipt.status === 1 ? 'SUCCESS (1)' : `FAILED (${receipt.status})`);
  
  if (receipt.status === 1 && tx.to?.toLowerCase() === expectedDestination.toLowerCase()) {
    console.log('SUCCESS: Transaction matches destination and is successful.');
  } else {
    console.log('WARNING: Transaction mismatch or failed.');
  }
}

verifyTx().catch(console.error);
