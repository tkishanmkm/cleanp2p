'use client';

import React, { useState } from 'react';
import { useUserWallets, SupportedChain } from '@/hooks/useUserWallets';

interface DepositSectionProps {
  userId: string;
}

const CHAINS: { id: SupportedChain; name: string; symbol: string }[] = [
  { id: 'BTC', name: 'Bitcoin', symbol: 'BTC' },
  { id: 'EVM', name: 'Ethereum / EVM', symbol: 'ETH / USDT (ERC20)' },
  { id: 'TRON', name: 'TRON Network', symbol: 'TRX / USDT (TRC20)' },
  { id: 'LTC', name: 'Litecoin', symbol: 'LTC' },
];

export const DepositSection: React.FC<DepositSectionProps> = ({ userId }) => {
  const { wallets, loading, error, refreshWallets } = useUserWallets(userId);
  const [selectedChain, setSelectedChain] = useState<SupportedChain>('BTC');
  const [copied, setCopied] = useState<boolean>(false);

  const currentAddress = wallets[selectedChain] || '';

  const handleCopy = async () => {
    if (!currentAddress) return;
    try {
      await navigator.clipboard.writeText(currentAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl text-white">
      <h2 className="text-xl font-bold mb-4 text-slate-100">Deposit Crypto</h2>

      {/* Chain Selector Tabs */}
      <div className="flex gap-2 mb-6 border-b border-slate-800 pb-3 overflow-x-auto">
        {CHAINS.map((chain) => (
          <button
            key={chain.id}
            onClick={() => {
              setSelectedChain(chain.id);
              setCopied(false);
            }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 whitespace-nowrap ${
              selectedChain === chain.id
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            {chain.name}
          </button>
        ))}
      </div>

      {/* Main Address Card */}
      <div className="space-y-4">
        <div className="flex justify-between items-center text-sm text-slate-400">
          <span>Assigned {selectedChain} Permanent Address</span>
          {loading && <span className="text-blue-400 animate-pulse">Syncing...</span>}
        </div>

        {error ? (
          <div className="p-4 bg-red-950/50 border border-red-800 rounded-xl text-red-300 text-sm flex justify-between items-center">
            <span>{error}</span>
            <button
              onClick={refreshWallets}
              className="px-3 py-1 bg-red-900 hover:bg-red-800 rounded-lg text-xs"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="relative flex items-center bg-slate-950 border border-slate-800 rounded-xl p-3">
            <input
              type="text"
              readOnly
              value={loading ? 'Generating address...' : currentAddress || 'No address derived'}
              className="w-full bg-transparent font-mono text-sm text-slate-200 focus:outline-none pr-24 select-all"
            />

            <button
              onClick={handleCopy}
              disabled={loading || !currentAddress}
              className={`absolute right-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50'
              }`}
            >
              {copied ? 'Copied! ✓' : 'Copy'}
            </button>
          </div>
        )}

        {/* Informational Guidance */}
        <div className="p-4 bg-slate-950/50 border border-slate-800/60 rounded-xl text-xs text-slate-400 space-y-1">
          <p className="font-medium text-slate-300">Important Deposit Info:</p>
          <p>
            • Send only <strong className="text-white">{selectedChain}</strong> assets to this address.
          </p>
          <p>• Deposits update automatically in real-time once confirmed on-chain.</p>
        </div>
      </div>
    </div>
  );
};

export default DepositSection;
