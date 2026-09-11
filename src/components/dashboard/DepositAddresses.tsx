'use client';

import { useState, useEffect } from 'react';

interface WalletAddresses {
  evm: string | null;
  tron: string | null;
  btc: string | null;
  ltc: string | null;
}

export default function DepositAddresses({ userId }: { userId: string }) {
  const [addresses, setAddresses] = useState<WalletAddresses>({
    evm: null,
    tron: null,
    btc: null,
    ltc: null,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    async function loadOrProvisionWallets() {
      try {
        const res = await fetch('/api/auth/provision-wallets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId }),
        });
        const data = await res.json();
        if (data.addresses) {
          setAddresses(data.addresses);
        }
      } catch (err) {
        console.error('Failed to load deposit addresses:', err);
      } finally {
        setLoading(false);
      }
    }

    if (userId) {
      loadOrProvisionWallets();
    }
  }, [userId]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return <div className="p-4 rounded-lg bg-gray-900 animate-pulse text-gray-400">Loading wallet addresses...</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* EVM Address */}
      <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
        <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">ETH / BSC / Polygon (EVM)</span>
        <div className="mt-2 flex items-center justify-between bg-black p-2 rounded border border-gray-800">
          <span className="font-mono text-xs truncate text-gray-200">{addresses.evm || 'Provisioning...'}</span>
          {addresses.evm && (
            <button
              onClick={() => handleCopy(addresses.evm!, 'evm')}
              className="ml-2 text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded transition"
            >
              {copied === 'evm' ? 'Copied!' : 'Copy'}
            </button>
          )}
        </div>
      </div>

      {/* TRON Address */}
      <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
        <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">TRON (TRC-20 USDT / TRX)</span>
        <div className="mt-2 flex items-center justify-between bg-black p-2 rounded border border-gray-800">
          <span className="font-mono text-xs truncate text-gray-200">{addresses.tron || 'Provisioning...'}</span>
          {addresses.tron && (
            <button
              onClick={() => handleCopy(addresses.tron!, 'tron')}
              className="ml-2 text-xs bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded transition"
            >
              {copied === 'tron' ? 'Copied!' : 'Copy'}
            </button>
          )}
        </div>
      </div>

      {/* Bitcoin Address */}
      {addresses.btc && (
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Bitcoin (BTC Native SegWit)</span>
          <div className="mt-2 flex items-center justify-between bg-black p-2 rounded border border-gray-800">
            <span className="font-mono text-xs truncate text-gray-200">{addresses.btc}</span>
            <button
              onClick={() => handleCopy(addresses.btc!, 'btc')}
              className="ml-2 text-xs bg-amber-600 hover:bg-amber-500 text-white px-2 py-1 rounded transition"
            >
              {copied === 'btc' ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Litecoin Address */}
      {addresses.ltc && (
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Litecoin (LTC Native SegWit)</span>
          <div className="mt-2 flex items-center justify-between bg-black p-2 rounded border border-gray-800">
            <span className="font-mono text-xs truncate text-gray-200">{addresses.ltc}</span>
            <button
              onClick={() => handleCopy(addresses.ltc!, 'ltc')}
              className="ml-2 text-xs bg-gray-600 hover:bg-gray-500 text-white px-2 py-1 rounded transition"
            >
              {copied === 'ltc' ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
