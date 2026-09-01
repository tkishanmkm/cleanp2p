'use client';

import { useState, useEffect } from 'react';

export default function WalletDashboard() {
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<{ evm_address: string; btc_address: string } | null>(null);
  const [balances, setBalances] = useState<any[]>([]);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawStatus, setWithdrawStatus] = useState('');

  useEffect(() => {
    async function loadWalletData() {
      try {
        // 1. Fetch assigned deposit addresses
        const walletRes = await fetch('/api/wallet/deposit-address');
        const walletData = await walletRes.json();
        if (walletData.wallet) {
          setWallet(walletData.wallet);

          // 2. Fetch live multi-chain balances
          const balanceRes = await fetch(`/api/wallet/balances?address=${walletData.wallet.evm_address}`);
          const balanceData = await balanceRes.json();
          if (balanceData.balances) {
            setBalances(balanceData.balances);
          }
        }
      } catch (err) {
        console.error('Failed to load wallet data', err);
      } finally {
        setLoading(false);
      }
    }
    loadWalletData();
  }, []);

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawStatus('Processing withdrawal...');

    try {
      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientAddress: withdrawAddress,
          amountEth: withdrawAmount,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setWithdrawStatus(`Success! Tx Hash: ${data.transactionHash}`);
      } else {
        setWithdrawStatus(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setWithdrawStatus(`Error: ${err.message}`);
    }
  };

  if (loading) return <div className="p-8">Loading multi-chain wallets...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">Multi-Chain Wallet Dashboard</h1>

      {/* Balances Section */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {balances.map((b) => (
          <div key={b.network} className="p-4 border rounded-lg shadow-sm bg-card">
            <p className="text-xs text-muted-foreground">{b.network}</p>
            <p className="text-xl font-semibold">{b.balance}</p>
            <p className="text-xs font-mono">{b.symbol}</p>
          </div>
        ))}
      </div>

      {/* Deposit Addresses */}
      <div className="p-6 border rounded-xl bg-card space-y-4">
        <h2 className="text-lg font-semibold">Your Deposit Addresses</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block">EVM (Ethereum / Arbitrum / Base / Polygon)</label>
            <div className="flex items-center gap-2 mt-1">
              <input readOnly value={wallet?.evm_address || ''} className="w-full p-2 border rounded font-mono text-sm bg-muted" />
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${wallet?.evm_address}`}
                alt="EVM Address QR Code"
                className="w-12 h-12 rounded border"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block">Bitcoin (Native SegWit)</label>
            <div className="flex items-center gap-2 mt-1">
              <input readOnly value={wallet?.btc_address || ''} className="w-full p-2 border rounded font-mono text-sm bg-muted" />
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${wallet?.btc_address}`}
                alt="BTC Address QR Code"
                className="w-12 h-12 rounded border"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Withdrawal Form */}
      <div className="p-6 border rounded-xl bg-card space-y-4">
        <h2 className="text-lg font-semibold">Withdraw Funds</h2>
        <form onSubmit={handleWithdraw} className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Destination EVM Address</label>
            <input
              type="text"
              required
              placeholder="0x..."
              value={withdrawAddress}
              onChange={(e) => setWithdrawAddress(e.target.value)}
              className="w-full p-2 border rounded text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Amount (ETH)</label>
            <input
              type="number"
              step="0.0001"
              required
              placeholder="0.01"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              className="w-full p-2 border rounded text-sm"
            />
          </div>
          <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium">
            Execute Withdrawal
          </button>
        </form>
        {withdrawStatus && <p className="text-sm font-mono mt-2">{withdrawStatus}</p>}
      </div>
    </div>
  );
}
