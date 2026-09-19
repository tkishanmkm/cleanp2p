'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import UserAvatar from '@/components/common/UserAvatar'
import { getPresenceStatus, formatJoinedDate, usePresenceStatus, resolveUserLastSeen } from '@/lib/presence'
import { createTradeOrderWithEscrow } from '@/app/ad/actions'

interface AdDetailClientProps {
  ad: any
  advertiser: any
  stats: {
    positiveFeedbacks: number
    negativeFeedbacks: number
    totalTrades: number
    avgPaySeconds?: number
    avgReleaseSeconds: number
    blockedBy: number
    hasBlocked: number
  }
}

const ASSET_ICONS: Record<string, string> = {
  BTC: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  USDT: 'https://assets.coingecko.com/coins/images/325/small/Tether.png',
  USDC: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
  ETH: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  LTC: 'https://assets.coingecko.com/coins/images/2/small/litecoin.png',
  SOL: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  BNB: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  TRX: 'https://assets.coingecko.com/coins/images/1094/small/tron-logo.png',
  MATIC: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
  DOGE: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  XRP: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
}

const FIAT_COUNTRY_CODES: Record<string, string> = {
  USD: 'us',
  EUR: 'eu',
  GBP: 'gb',
  INR: 'in',
  CAD: 'ca',
  AUD: 'au',
  JPY: 'jp',
  CNY: 'cn',
  CHF: 'ch',
  HKD: 'hk',
  NZD: 'nz',
  SEK: 'se',
  KRW: 'kr',
  SGD: 'sg',
  NOK: 'no',
  MXN: 'mx',
  RUB: 'ru',
  ZAR: 'za',
  TRY: 'tr',
  BRL: 'br',
  AED: 'ae',
  PKR: 'pk',
  BDT: 'bd',
  NGN: 'ng',
  PHP: 'ph',
  IDR: 'id',
  VND: 'vn',
  THB: 'th',
  MYR: 'my',
  PLN: 'pl',
  COP: 'co',
  ARS: 'ar',
  CLP: 'cl',
  PEN: 'pe',
  KES: 'ke',
  GHS: 'gh',
  EGP: 'eg',
  UAH: 'ua',
}

const getFiatFlagUrl = (fiat: string): string => {
  const code = FIAT_COUNTRY_CODES[fiat.toUpperCase()] || 'us'
  return `https://flagcdn.com/w40/${code.toLowerCase()}.png`
}

export default function AdDetailClient({ ad, advertiser, stats }: AdDetailClientProps) {
  const router = useRouter()
  const [fiatInput, setFiatInput] = useState<string>('')
  const [cryptoInput, setCryptoInput] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Asset & Currency Normalization
  const asset = (ad.asset_symbol || ad.asset || ad.crypto || ad.crypto_symbol || ad.cryptoSymbol || ad.coin || ad.crypto_currency || 'BTC').toUpperCase()
  const fiatCurrency = (ad.fiat_symbol || ad.fiat_currency || ad.fiatCurrency || ad.fiat || ad.currency || 'USD').toUpperCase()
  const unitPrice = parseFloat(ad.price || ad.unit_price || ad.fixed_rate || ad.fixedRate || '0')
  const rawSide = String(ad.type || ad.side || ad.ad_type || ad.adType || 'SELL').toUpperCase()
  const isAdvertiserBuyer = rawSide.includes('BUY')
  const ESCROW_FEE_RATE = 0.015 // 1.5% Escrow Fee

  const presence = usePresenceStatus(advertiser, 15000)

  const paymentMethods: string[] = Array.isArray(ad.payment_methods)
    ? ad.payment_methods
    : typeof ad.payment_methods === 'string'
    ? JSON.parse(ad.payment_methods || '[]')
    : []

  // Dynamic Escrow Calculations
  const cryptoNum = parseFloat(cryptoInput) || 0
  const escrowFeeCrypto = cryptoNum * ESCROW_FEE_RATE
  const netReceivedCrypto = cryptoNum
  const totalSellerLock = cryptoNum * (1 + ESCROW_FEE_RATE)

  // Feedback Metrics
  const totalFeedbacks = (stats.positiveFeedbacks || 0) + (stats.negativeFeedbacks || 0)
  const positivePercentage = totalFeedbacks > 0 
    ? (((stats.positiveFeedbacks || 0) / totalFeedbacks) * 100).toFixed(1) 
    : '100.0'

  // Form Handlers
  const handleFiatChange = (val: string) => {
    setFiatInput(val)
    if (unitPrice > 0 && !isNaN(parseFloat(val))) {
      setCryptoInput((parseFloat(val) / unitPrice).toFixed(6))
    } else {
      setCryptoInput('')
    }
  }

  const handleCryptoChange = (val: string) => {
    setCryptoInput(val)
    if (unitPrice > 0 && !isNaN(parseFloat(val))) {
      setFiatInput((parseFloat(val) * unitPrice).toFixed(2))
    } else {
      setFiatInput('')
    }
  }

  const formatSeconds = (seconds?: number) => {
    if (!seconds || seconds === 0) return 'N/A'
    if (seconds < 60) return `${Math.round(seconds)} sec`
    return `${(seconds / 60).toFixed(1)} min`
  }

  const handleInitiateTrade = async () => {
    setErrorMsg(null)
    const fiatVal = parseFloat(fiatInput)
    const minLimit = Number(ad.min_limit || 0)
    const maxLimit = Number(ad.max_limit || 99999999)

    if (isNaN(fiatVal) || fiatVal <= 0) {
      setErrorMsg('Please enter a valid trade amount.')
      return
    }

    if (fiatVal < minLimit || fiatVal > maxLimit) {
      setErrorMsg(`Amount must be between ${minLimit.toLocaleString()} and ${maxLimit.toLocaleString()} ${fiatCurrency}.`)
      return
    }

    setIsSubmitting(true)
    try {
      const cleanAdId = String(ad.public_ad_id || ad.public_id || ad.id || '').replace(/^#/, '').trim()
      const res = await createTradeOrderWithEscrow({ adId: cleanAdId, fiatAmount: fiatVal })
      if (res.error) {
        setErrorMsg(res.error.message)
        setIsSubmitting(false)
        return
      }
      if (res.data?.orderId) {
        router.push(`/trade/${res.data.orderId}`)
      } else {
        router.push('/trade')
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'An unexpected error occurred.')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 text-neutral-900 dark:text-neutral-100 min-h-screen">
      {/* Header Section */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between border-b pb-4 dark:border-neutral-800 gap-4">
        <div>
          <Link 
            href="/buy" 
            className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 flex items-center gap-1 transition-colors"
          >
            ← Back to Marketplace
          </Link>
          <div className="flex items-center gap-3 mt-2">
            <UserAvatar 
              avatarUrl={advertiser?.avatar_url} 
              username={advertiser?.username} 
              size="md" 
              className="ring-2 ring-blue-500/20 shadow-sm"
            />
            <div className="flex items-center gap-2">
              <img 
                src={ASSET_ICONS[asset] || ASSET_ICONS.BTC} 
                alt={asset} 
                className="w-5 h-5 rounded-full shadow-xs" 
              />
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                {isAdvertiserBuyer 
                  ? `Sell ${asset} to @${advertiser?.username || 'user'}` 
                  : `Buy ${asset} from @${advertiser?.username || 'user'}`}
              </h1>
            </div>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Ad ID: <span className="font-mono">{ad.id}</span> • Protected by PaxOnes Escrow
          </p>
        </div>

        {/* Currency & Unit Price Header */}
        <div className="text-left sm:text-right py-1">
          <div className="flex items-center sm:justify-end gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 font-medium">
            <img
              src={getFiatFlagUrl(fiatCurrency)}
              alt={fiatCurrency}
              className="w-4 h-3 object-cover rounded-xs border border-neutral-300 dark:border-neutral-600 shadow-xs"
            />
            <span>{fiatCurrency} Unit Price</span>
          </div>
          <span className="text-2xl font-extrabold text-blue-600 dark:text-blue-400 tracking-tight">
            {unitPrice.toLocaleString()} {fiatCurrency}/{asset}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="p-5 sm:p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">
              Enter Trade Amount
            </h2>

            {errorMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs rounded-lg">
                {errorMsg}
              </div>
            )}

            <div className="space-y-4">
              {/* Pay/Sell Input */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                  {isAdvertiserBuyer ? `I Want to Sell (${asset})` : `I Want to Pay (${fiatCurrency})`}
                </label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    value={isAdvertiserBuyer ? cryptoInput : fiatInput}
                    onChange={(e) => isAdvertiserBuyer ? handleCryptoChange(e.target.value) : handleFiatChange(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-3.5 pl-4 pr-32 border rounded-xl bg-neutral-50/50 dark:bg-neutral-800/60 border-neutral-200 dark:border-neutral-700 font-mono text-lg font-medium focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                  <div className="absolute right-3 flex items-center gap-1.5 bg-neutral-100 dark:bg-neutral-700 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-600 text-xs font-semibold shadow-xs">
                    {isAdvertiserBuyer ? (
                      <>
                        <img src={ASSET_ICONS[asset] || ASSET_ICONS.BTC} className="w-4 h-4 rounded-full" alt={asset} />
                        <span className="text-neutral-800 dark:text-neutral-200">{asset}</span>
                      </>
                    ) : (
                      <>
                        <img
                          src={getFiatFlagUrl(fiatCurrency)}
                          alt={fiatCurrency}
                          className="w-4 h-3 object-cover rounded-xs border border-neutral-300 dark:border-neutral-600 shadow-xs"
                        />
                        <span className="text-neutral-800 dark:text-neutral-200">{fiatCurrency}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Receive Input */}
              <div>
                <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                  {isAdvertiserBuyer ? `I Will Receive (${fiatCurrency})` : `I Will Receive (${asset})`}
                </label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    value={isAdvertiserBuyer ? fiatInput : cryptoInput}
                    onChange={(e) => isAdvertiserBuyer ? handleFiatChange(e.target.value) : handleCryptoChange(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-3.5 pl-4 pr-32 border rounded-xl bg-neutral-50/50 dark:bg-neutral-800/60 border-neutral-200 dark:border-neutral-700 font-mono text-lg font-medium focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                  <div className="absolute right-3 flex items-center gap-1.5 bg-neutral-100 dark:bg-neutral-700 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-600 text-xs font-semibold shadow-xs">
                    {isAdvertiserBuyer ? (
                      <>
                        <img
                          src={getFiatFlagUrl(fiatCurrency)}
                          alt={fiatCurrency}
                          className="w-4 h-3 object-cover rounded-xs border border-neutral-300 dark:border-neutral-600 shadow-xs"
                        />
                        <span className="text-neutral-800 dark:text-neutral-200">{fiatCurrency}</span>
                      </>
                    ) : (
                      <>
                        <img src={ASSET_ICONS[asset] || ASSET_ICONS.BTC} className="w-4 h-4 rounded-full" alt={asset} />
                        <span className="text-neutral-800 dark:text-neutral-200">{asset}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Escrow Fee Breakdown */}
              <div className="p-4 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 rounded-xl text-xs space-y-2 font-mono">
                <div className="flex justify-between text-neutral-700 dark:text-neutral-300">
                  <span>Trade Amount:</span>
                  <span className="font-bold">{cryptoNum.toFixed(4)} {asset}</span>
                </div>
                <div className="flex justify-between text-neutral-700 dark:text-neutral-300">
                  <span>Escrow Fee (1.5%):</span>
                  <span className="font-bold">{escrowFeeCrypto.toFixed(4)} {asset}</span>
                </div>
                <div className="flex justify-between font-semibold text-blue-900 dark:text-blue-300 border-t pt-1">
                  <span>Total Locked from Wallet:</span>
                  <span className="font-bold">{totalSellerLock.toFixed(4)} {asset}</span>
                </div>
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-medium pt-0.5">
                  <span>Net Received by Buyer:</span>
                  <span className="font-bold">{netReceivedCrypto.toFixed(4)} {asset}</span>
                </div>
              </div>

              <div className="flex flex-wrap justify-between text-xs text-neutral-500 dark:text-neutral-400 px-1 gap-2">
                <span>Order Limits: <strong>{ad.min_limit} – {ad.max_limit} {fiatCurrency}</strong></span>
                <span>Payment Window: <strong>{ad.payment_window_minutes || ad.payment_window || 30} Mins</strong></span>
              </div>

              <button
                type="button"
                onClick={handleInitiateTrade}
                disabled={isSubmitting}
                className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white font-bold rounded-xl shadow-md transition-all active:scale-[0.99] cursor-pointer"
              >
                {isSubmitting ? 'Initiating Escrow Trade...' : (isAdvertiserBuyer ? `Sell ${asset} Now` : `Buy ${asset} Now`)}
              </button>
            </div>
          </div>

          {/* Offer Details */}
          <div className="p-5 sm:p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm space-y-4">
            <h3 className="font-semibold text-base text-neutral-800 dark:text-neutral-200">
              Offer Terms & Methods
            </h3>
            
            <div>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 block mb-2">Accepted Payment Methods</span>
              <div className="flex flex-wrap gap-2">
                {paymentMethods.length > 0 ? (
                  paymentMethods.map((pm, idx) => (
                    <span key={idx} className="px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                      {pm}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-neutral-400">No specific methods defined</span>
                )}
              </div>
            </div>

            <div>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 block mb-1.5">Advertiser Terms</span>
              <div className="p-3.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-xl text-xs leading-relaxed text-neutral-700 dark:text-neutral-300 border border-neutral-200/60 dark:border-neutral-800">
                {ad.terms || 'No custom terms provided by advertiser. Please pay from your own verified account.'}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Trader Info */}
        <div className="p-5 sm:p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm h-fit space-y-5">
          <h3 className="font-semibold text-base border-b pb-3 dark:border-neutral-800 text-neutral-800 dark:text-neutral-200">
            Trader Information
          </h3>

          <div className="flex items-center space-x-3">
            <UserAvatar avatarUrl={advertiser?.avatar_url} username={advertiser?.username} size="lg" />
            <div>
              <p className="font-bold text-base text-neutral-900 dark:text-neutral-100">
                @{advertiser?.username || 'titan721'}
              </p>
              <div className="flex items-center space-x-1.5 text-xs mt-0.5">
                <span className={`w-2 h-2 rounded-full ${presence.isOnline ? 'bg-green-500' : 'bg-neutral-400'}`}></span>
                <span className="text-neutral-500 dark:text-neutral-400">{presence.label}</span>
                <span className="text-neutral-400 dark:text-neutral-600">•</span>
                <span className="text-neutral-500 dark:text-neutral-400">{formatJoinedDate(advertiser?.created_at)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/50 dark:border-neutral-800">
              <span className="text-neutral-500 dark:text-neutral-400 block mb-0.5">Positive</span>
              <span className="font-bold text-sm text-green-600 dark:text-green-400">{stats.positiveFeedbacks || 0}</span>
              <span className="text-[11px] text-neutral-400 block mt-0.5">{positivePercentage}% positive</span>
            </div>

            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/50 dark:border-neutral-800">
              <span className="text-neutral-500 dark:text-neutral-400 block mb-0.5">Negative</span>
              <span className="font-bold text-sm text-red-600 dark:text-red-400">{stats.negativeFeedbacks || 0}</span>
              <span className="text-[11px] text-neutral-400 block mt-0.5">{stats.totalTrades || 0} total trades</span>
            </div>

            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/50 dark:border-neutral-800">
              <span className="text-neutral-500 dark:text-neutral-400 block mb-0.5">Avg Pay Time</span>
              <span className="font-bold text-sm">{formatSeconds(stats.avgPaySeconds)}</span>
              <span className="text-[11px] text-neutral-400 block mt-0.5">Buyer speed metric</span>
            </div>

            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/50 dark:border-neutral-800">
              <span className="text-neutral-500 dark:text-neutral-400 block mb-0.5">Avg Release</span>
              <span className="font-bold text-sm">{formatSeconds(stats.avgReleaseSeconds)}</span>
              <span className="text-[11px] text-neutral-400 block mt-0.5">Seller release speed</span>
            </div>

            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/50 dark:border-neutral-800">
              <span className="text-neutral-500 dark:text-neutral-400 block mb-0.5">Blocked By</span>
              <span className="font-bold text-sm">{stats.blockedBy || 0}</span>
              <span className="text-[11px] text-neutral-400 block mt-0.5">traders</span>
            </div>

            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/50 dark:border-neutral-800">
              <span className="text-neutral-500 dark:text-neutral-400 block mb-0.5">Has Blocked</span>
              <span className="font-bold text-sm">{stats.hasBlocked || 0}</span>
              <span className="text-[11px] text-neutral-400 block mt-0.5">traders</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
