'use client';

import React, { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Copy,
  Check,
  QrCode,
  ShieldCheck,
  AlertTriangle,
  ArrowDownLeft,
  RefreshCw,
  ExternalLink,
  Layers,
  Info,
} from 'lucide-react';

interface DepositAddressesResponse {
  success: boolean;
  authenticated?: boolean;
  userId?: string;
  walletIndex?: number;
  addresses: {
    BTC: string;
    ETH: string;
    LTC: string;
    USDT_ERC20: string;
    USDT_BEP20: string;
    USDT_TRC20: string;
  };
  metadata?: {
    btcDerivationPath?: string;
    ethDerivationPath?: string;
    ltcDerivationPath?: string;
    tronDerivationPath?: string;
    evmAddressReusedFor?: string[];
    derivedAt?: string;
  };
}

interface AssetOption {
  id: keyof DepositAddressesResponse['addresses'];
  name: string;
  symbol: string;
  network: string;
  standard: string;
  chain: string;
  color: string;
  bgColor: string;
  borderColor: string;
  minDeposit: string;
  confirmations: string;
  warning: string;
  derivationPathKey: string;
}

const ASSET_OPTIONS: AssetOption[] = [
  {
    id: 'BTC',
    name: 'Bitcoin',
    symbol: 'BTC',
    network: 'Bitcoin Network',
    standard: 'Native SegWit (P2WPKH)',
    chain: 'BITCOIN',
    color: 'text-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950/40',
    borderColor: 'border-amber-200 dark:border-amber-800',
    minDeposit: '0.0005 BTC',
    confirmations: '2 Block Confirmations',
    warning: 'Send only Bitcoin (BTC) to this address. Sending any other asset or utilizing an unaligned network will result in permanent loss.',
    derivationPathKey: "m/84'/0'/0'/0",
  },
  {
    id: 'ETH',
    name: 'Ethereum',
    symbol: 'ETH',
    network: 'Ethereum Mainnet',
    standard: 'ERC-20 / Native',
    chain: 'ETHEREUM',
    color: 'text-indigo-500',
    bgColor: 'bg-indigo-50 dark:bg-indigo-950/40',
    borderColor: 'border-indigo-200 dark:border-indigo-800',
    minDeposit: '0.005 ETH',
    confirmations: '12 Network Confirmations',
    warning: 'Send only Ethereum (ETH) or supported ERC-20 assets to this EVM address on the Ethereum network.',
    derivationPathKey: "m/44'/60'/0'/0",
  },
  {
    id: 'USDT_ERC20',
    name: 'Tether USD',
    symbol: 'USDT',
    network: 'Ethereum (ERC-20)',
    standard: 'ERC-20 Token',
    chain: 'ETHEREUM',
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/40',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
    minDeposit: '10.00 USDT',
    confirmations: '12 Network Confirmations',
    warning: 'Send only USDT via ERC-20 (Ethereum). Sending via BSC or TRON to this specific network setting may cause processing delays.',
    derivationPathKey: "m/44'/60'/0'/0",
  },
  {
    id: 'USDT_BEP20',
    name: 'Tether USD',
    symbol: 'USDT',
    network: 'BNB Smart Chain (BEP-20)',
    standard: 'BEP-20 Token',
    chain: 'BSC',
    color: 'text-yellow-500',
    bgColor: 'bg-yellow-50 dark:bg-yellow-950/40',
    borderColor: 'border-yellow-200 dark:border-yellow-800',
    minDeposit: '5.00 USDT',
    confirmations: '15 Network Confirmations',
    warning: 'Send only USDT via BNB Smart Chain (BEP-20). Shares your deterministic EVM deposit address.',
    derivationPathKey: "m/44'/60'/0'/0",
  },
  {
    id: 'USDT_TRC20',
    name: 'Tether USD',
    symbol: 'USDT',
    network: 'TRON Network (TRC-20)',
    standard: 'TRC-20 Token',
    chain: 'TRON',
    color: 'text-red-500',
    bgColor: 'bg-red-50 dark:bg-red-950/40',
    borderColor: 'border-red-200 dark:border-red-800',
    minDeposit: '5.00 USDT',
    confirmations: '19 Block Confirmations',
    warning: 'Send only USDT via TRON (TRC-20) starting with "T". Fast and low fee transfer route.',
    derivationPathKey: "m/44'/195'/0'/0",
  },
  {
    id: 'LTC',
    name: 'Litecoin',
    symbol: 'LTC',
    network: 'Litecoin Network',
    standard: 'Native SegWit (P2WPKH)',
    chain: 'LITECOIN',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950/40',
    borderColor: 'border-blue-200 dark:border-blue-800',
    minDeposit: '0.01 LTC',
    confirmations: '6 Block Confirmations',
    warning: 'Send only Litecoin (LTC) to this native SegWit address (starting with ltc1 or tltc1).',
    derivationPathKey: "m/84'/2'/0'/0",
  },
];

export default function DepositAddressPrecheckPage() {
  const [selectedAssetId, setSelectedAssetId] = useState<keyof DepositAddressesResponse['addresses']>('BTC');
  const [depositData, setDepositData] = useState<DepositAddressesResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const selectedAsset = ASSET_OPTIONS.find((a) => a.id === selectedAssetId) || ASSET_OPTIONS[0];

  const fetchDepositAddresses = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/wallet/deposit-addresses', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data: DepositAddressesResponse = await res.json();
      if (!res.ok || !data.success) {
        throw new Error((data as any).error || 'Failed to retrieve deposit addresses');
      }
      setDepositData(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown network error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDepositAddresses();
  }, []);

  const currentAddress = depositData?.addresses?.[selectedAssetId] || 'Generating deposit address...';

  const handleCopy = async () => {
    if (!currentAddress || currentAddress.includes('...')) return;
    try {
      await navigator.clipboard.writeText(currentAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  return (
    <div id="deposit-precheck-root" className="min-h-screen bg-neutral-900 text-neutral-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-800 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <ArrowDownLeft className="w-5 h-5" />
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-white">Deposit Crypto</h1>
            </div>
            <p className="text-sm text-neutral-400 mt-1">
              Select an asset and network to view your deterministic on-chain deposit address.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="refresh-addresses-btn"
              onClick={fetchDepositAddresses}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors border border-neutral-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-950/60 text-emerald-400 border border-emerald-800">
              <ShieldCheck className="w-3.5 h-3.5" />
              HD BIP-84/44 Verified
            </div>
          </div>
        </div>

        {/* Asset & Network Selector Pills */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
            Select Asset & Network
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
            {ASSET_OPTIONS.map((asset) => {
              const isSelected = selectedAssetId === asset.id;
              return (
                <button
                  key={asset.id}
                  id={`pill-select-${asset.id}`}
                  onClick={() => setSelectedAssetId(asset.id)}
                  className={`p-3 rounded-xl border text-left transition-all duration-150 flex flex-col justify-between ${
                    isSelected
                      ? 'bg-neutral-800 border-emerald-500 shadow-md ring-1 ring-emerald-500/50'
                      : 'bg-neutral-900 border-neutral-800 hover:border-neutral-700 hover:bg-neutral-850'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className={`text-sm font-bold ${asset.color}`}>{asset.symbol}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                  </div>
                  <div className="mt-2">
                    <div className="text-xs font-medium text-neutral-200 truncate">{asset.network}</div>
                    <div className="text-[10px] text-neutral-500 truncate">{asset.standard}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="p-4 rounded-xl bg-red-950/40 border border-red-800 text-red-300 text-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Deposit Engine Notice</p>
              <p className="text-xs text-red-400 mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Main Deposit Box */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 p-6 rounded-2xl bg-neutral-850 border border-neutral-800">
          {/* QR Code & Mobile Visual */}
          <div className="md:col-span-5 flex flex-col items-center justify-center p-6 rounded-xl bg-neutral-900 border border-neutral-800 space-y-4">
            <div className="p-3 bg-white rounded-xl shadow-inner flex items-center justify-center">
              {loading ? (
                <div className="w-44 h-44 flex items-center justify-center bg-neutral-100 rounded-lg">
                  <RefreshCw className="w-8 h-8 text-neutral-400 animate-spin" />
                </div>
              ) : (
                <QRCodeSVG
                  value={currentAddress}
                  size={176}
                  level="H"
                  includeMargin={false}
                />
              )}
            </div>

            <div className="text-center space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs text-neutral-400">
                <QrCode className="w-3.5 h-3.5" />
                Scan QR Code with your wallet
              </div>
              <p className="text-[11px] text-neutral-500">
                Supports Trust Wallet, MetaMask, Binance, Ledger & Trezor
              </p>
            </div>
          </div>

          {/* Address Details & Metadata */}
          <div className="md:col-span-7 flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              {/* Asset Badge Header */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    Target Network
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <h2 className="text-lg font-bold text-white">{selectedAsset.name}</h2>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300 border border-neutral-700">
                      {selectedAsset.network}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[11px] text-neutral-400">Derivation Path</span>
                  <div className="text-xs font-mono text-neutral-300">
                    {selectedAsset.derivationPathKey}/{depositData?.walletIndex || 1}
                  </div>
                </div>
              </div>

              {/* Deposit Address Box */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  Your Deposit Address
                </label>
                <div className="p-3.5 rounded-xl bg-neutral-900 border border-neutral-700/80 flex items-center justify-between gap-3">
                  <div className="font-mono text-xs md:text-sm text-emerald-400 break-all select-all font-medium">
                    {loading ? 'Retrieving deterministic key...' : currentAddress}
                  </div>
                  <button
                    id="copy-deposit-address-btn"
                    onClick={handleCopy}
                    disabled={loading}
                    className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                      copied
                        ? 'bg-emerald-600 text-white'
                        : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" /> Copy
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Network Parameters Grid */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-3 rounded-lg bg-neutral-900/80 border border-neutral-800 space-y-0.5">
                  <div className="text-[11px] text-neutral-400">Minimum Deposit</div>
                  <div className="text-xs font-bold text-neutral-200">{selectedAsset.minDeposit}</div>
                </div>
                <div className="p-3 rounded-lg bg-neutral-900/80 border border-neutral-800 space-y-0.5">
                  <div className="text-[11px] text-neutral-400">Crediting Requirement</div>
                  <div className="text-xs font-bold text-neutral-200">{selectedAsset.confirmations}</div>
                </div>
              </div>
            </div>

            {/* Warning Banner */}
            <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/60 text-amber-200/90 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="leading-relaxed">{selectedAsset.warning}</p>
            </div>
          </div>
        </div>

        {/* EVM Shared Address Explanation Note */}
        {(selectedAssetId === 'ETH' || selectedAssetId === 'USDT_ERC20' || selectedAssetId === 'USDT_BEP20') && (
          <div className="p-4 rounded-xl bg-neutral-850 border border-neutral-800 text-xs text-neutral-400 flex items-start gap-3">
            <Layers className="w-4 h-4 text-indigo-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-neutral-200">Shared EVM Address Architecture</p>
              <p>
                Ethereum (ETH), Tether USD ERC-20, and Tether USD BEP-20 all deterministically map to your single EVM address (m/44&apos;/60&apos;/0&apos;/0/{depositData?.walletIndex || 1}). Deposits on respective chains are automatically detected and credited by the Paxones on-chain engine.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
