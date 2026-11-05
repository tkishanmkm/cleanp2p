'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { clearPendingWithdrawalKey, getOrCreatePendingWithdrawalKey } from '@/lib/withdrawal-idempotency-store';

export default function WalletDashboard() {
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<{ evm_address: string; btc_address: string } | null>(null);
  const [balances, setBalances] = useState<any[]>([]);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [withdrawStatus, setWithdrawStatus] = useState('');

  useEffect(() => {
    async function loadWalletData() {
      try {
        // 1. Fetch assigned deposit addresses
        const walletRes = await fetch('/api/wallet/deposit-address');
        const walletData = await walletRes.json();
        const evmAddr = walletData.addresses?.evm || walletData.wallet?.evm_address || '';
        const btcAddr = walletData.addresses?.btc || walletData.wallet?.btc_address || '';

        if (evmAddr || btcAddr) {
          setWallet({
            evm_address: evmAddr,
            btc_address: btcAddr,
          });
        }

        // Fetch balances regardless of address provisioning state, using the
        // authenticated user's authoritative wallet endpoint.
        const balanceRes = await fetch('/api/wallet/balance', { cache: 'no-store' });
        const balanceData = await balanceRes.json();
        if (balanceRes.ok && balanceData.success && balanceData.balances) {
          const map = balanceData.balances;
          setBalances([
            { network: 'Ethereum Mainnet', symbol: 'ETH', balance: Number(map.ETH?.available ?? 0).toFixed(4) },
            { network: 'USDT (All Chains)', symbol: 'USDT', balance: Number(map.USDT?.available ?? 0).toFixed(2) },
            { network: 'Bitcoin', symbol: 'BTC', balance: Number(map.BTC?.available ?? 0).toFixed(6) },
            { network: 'Litecoin', symbol: 'LTC', balance: Number(map.LTC?.available ?? 0).toFixed(4) },
          ]);
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
    setWithdrawStatus('Submitting withdrawal request...');

    let userId: string | null = null;
    let fingerprint = '';
    let idempotencyKey = '';
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user?.id) throw new Error('Please sign in again before withdrawing.');

      const amount = Number(withdrawAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a valid positive amount.');
      const destinationAddress = withdrawAddress.trim();
      userId = user.id;
      fingerprint = JSON.stringify(['ETH', 'ETH', destinationAddress, amount]);
      idempotencyKey = await getOrCreatePendingWithdrawalKey(userId, fingerprint);

      const res = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({
          asset: 'ETH',
          network: 'ETH',
          destinationAddress,
          amount,
          totpCode: totpCode.trim(),
        }),
      });

      const data = await res.json();
      const withdrawalId = data?.withdrawalId || data?.withdrawal_id;
      if (
        !res.ok ||
        data?.success !== true ||
        typeof withdrawalId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(withdrawalId)
      ) {
        throw new Error(data?.error || 'Withdrawal result could not be confirmed. Check withdrawal history before retrying.');
      }

      await clearPendingWithdrawalKey(userId, fingerprint, idempotencyKey);
      setWithdrawStatus(`Withdrawal queued: ${withdrawalId} (status: ${data.status || 'QUEUED'}). Check withdrawal history for updates.`);
    } catch (err: any) {
      setWithdrawStatus(`Error: ${err?.message || 'Withdrawal request failed'}`);
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
            <label className="text-xs text-muted-foreground block">EVM (Ethereum / BNB Smart Chain)</label>
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
              min="0.0001"
              placeholder="0.01"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              className="w-full p-2 border rounded text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">2FA code (if enabled)</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{4,8}"
              maxLength={8}
              placeholder="Enter authenticator code"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
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
