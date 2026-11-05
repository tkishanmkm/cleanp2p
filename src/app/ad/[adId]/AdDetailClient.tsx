'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import UserAvatar from '@/components/common/UserAvatar'
import { usePresenceStatus } from '@/lib/presence'
import { useI18n } from '@/context/i18n-context'
import { createTradeOrderWithEscrow } from '@/app/ad/actions'
import { usePlatformFeeSettings } from '@/hooks/use-platform-fees'

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
  const { t, language } = useI18n()
  const [fiatInput, setFiatInput] = useState<string>('')
  const [cryptoInput, setCryptoInput] = useState<string>('')
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const { fees: platformFees, isLoading: isFeeSettingsLoading, error: feeSettingsError } = usePlatformFeeSettings()
  // Asset & Currency Normalization
  const asset = (ad.asset_symbol || ad.asset || ad.crypto || ad.crypto_symbol || ad.cryptoSymbol || ad.coin || ad.crypto_currency || 'BTC').toUpperCase()
  const fiatCurrency = (ad.fiat_symbol || ad.fiat_currency || ad.fiatCurrency || ad.fiat || ad.currency || 'USD').toUpperCase()
  const unitPrice = parseFloat(ad.price || ad.unit_price || ad.fixed_rate || ad.fixedRate || '0')
  const rawSide = String(ad.trade_type || ad.type || ad.side || ad.ad_type || ad.adType || '').toUpperCase()
  const isAdvertiserBuyer = rawSide === 'BUY' || rawSide === 'ONLINE_BUY' || rawSide.includes('BUY')
  const ESCROW_FEE_RATE = platformFees ? platformFees.escrowFeePercent / 100 : 0

  const presence = usePresenceStatus(advertiser, 15000)

  const paymentMethods: string[] = Array.isArray(ad.payment_methods)
    ? ad.payment_methods
    : typeof ad.payment_methods === 'string'
    ? JSON.parse(ad.payment_methods || '[]')
    : []

  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>(
    paymentMethods[0] || ad.payment_method || 'Bank Transfer'
  )

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
    if (!seconds || seconds === 0) return t('adDetailPage.notAvailable')
    if (seconds < 60) return t('adDetailPage.seconds').replace('{count}', String(Math.round(seconds)))
    return t('adDetailPage.minutesShort').replace('{count}', (seconds / 60).toFixed(1))
  }

  const localizedPresenceLabel = presence.isOnline
    ? t('p2pAdCard.online')
    : presence.label === 'Offline'
      ? t('p2pAdCard.offline')
      : (() => {
          const match = presence.label.match(/^Last seen (\d+)(m|h|d) ago$/)
          if (!match) return presence.label
          const key = match[2] === 'm' ? 'lastSeenMinutes' : match[2] === 'h' ? 'lastSeenHours' : 'lastSeenDays'
          return t('p2pAdCard.' + key).replace('{count}', match[1])
        })()

  const localizedJoinedDate = (createdAt?: string | null) => {
    if (!createdAt) return t('p2pAdCard.joinedRecently')
    const created = new Date(createdAt)
    if (Number.isNaN(created.getTime())) return t('p2pAdCard.joinedRecently')
    const diffInDays = Math.floor((Date.now() - created.getTime()) / (1000 * 3600 * 24))
    if (diffInDays < 1) return t('p2pAdCard.joinedToday')
    if (diffInDays === 1) return t('p2pAdCard.joinedDays').replace('{count}', '1')
    if (diffInDays < 30) return t('p2pAdCard.joinedDays').replace('{count}', diffInDays.toLocaleString(language))
    const diffInMonths = Math.floor(diffInDays / 30)
    if (diffInMonths < 12) return t('p2pAdCard.joinedMonths').replace('{count}', diffInMonths.toLocaleString(language))
    const diffInYears = Math.floor(diffInDays / 365)
    return t('p2pAdCard.joinedYears').replace('{count}', diffInYears.toLocaleString(language))
  }

  const handleInitiateTrade = async () => {
    setErrorMsg(null)
    if (isFeeSettingsLoading || !platformFees) {
      setErrorMsg(feeSettingsError || t('adDetailPage.feeSettingsUnavailable'))
      return
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      setErrorMsg(t('adDetailPage.invalidPrice'))
      return
    }
    const fiatVal = parseFloat(fiatInput)
    const minLimit = Number(ad.min_limit ?? ad.min_amount ?? 0)
    const maxLimit = Number(ad.max_limit ?? ad.max_amount ?? 0)

    if (isNaN(minLimit) || minLimit <= 0 || isNaN(maxLimit) || maxLimit < minLimit) {
      setErrorMsg(t('adDetailPage.invalidLimits'))
      return
    }

    if (isNaN(fiatVal) || fiatVal <= 0) {
      setErrorMsg(t('adDetailPage.invalidAmount'))
      return
    }

    if (fiatCurrency === 'USD' && fiatVal < platformFees.minTradeAmount) {
      setErrorMsg(t('adDetailPage.minimumTrade').replace('{amount}', platformFees.minTradeAmount.toLocaleString(language)))
      return
    }

    if (fiatVal < minLimit || fiatVal > maxLimit) {
      setErrorMsg(t('adDetailPage.amountRange').replace('{min}', minLimit.toLocaleString(language)).replace('{max}', maxLimit.toLocaleString(language)).replace('{currency}', fiatCurrency))
      return
    }

    if (paymentMethods.length > 1 && !selectedPaymentMethod) {
      setErrorMsg(t('adDetailPage.selectPaymentMethodError'))
      return
    }

    setIsSubmitting(true)
    try {
      const cleanAdId = String(ad.public_ad_id || ad.public_id || ad.id || '').replace(/^#/, '').trim()
      const paymentMethod = selectedPaymentMethod || paymentMethods[0] || 'Bank Transfer'
      // Reuse the same key for retries of the same request, but generate a
      // different key when the amount or payment method changes.
      const idempotencyStorageKey = `pax_p2p_idemp_${cleanAdId}_${encodeURIComponent(String(fiatVal))}_${encodeURIComponent(paymentMethod)}`
      let idempotencyKey = ''
      if (typeof window !== 'undefined' && window.sessionStorage) {
        idempotencyKey = window.sessionStorage.getItem(idempotencyStorageKey) || ''
        if (!idempotencyKey || idempotencyKey.length < 8) {
          idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : 'idemp_' + Math.random().toString(36).substring(2)
          window.sessionStorage.setItem(idempotencyStorageKey, idempotencyKey)
        }
      } else {
        idempotencyKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : 'idemp_' + Math.random().toString(36).substring(2)
      }
      const res = await createTradeOrderWithEscrow({
        adId: cleanAdId,
        fiatAmount: fiatVal,
        paymentMethod,
        idempotencyKey,
      })
      if (res.error) {
        setErrorMsg(res.error.message)
        setIsSubmitting(false)
        return
      }
      if (res.data?.orderId) {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.removeItem(idempotencyStorageKey);
        }
        router.push(`/trade/${res.data.orderId}`)
      } else {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.removeItem(idempotencyStorageKey);
        }
        router.push('/trade')
      }
    } catch (err: any) {
      setErrorMsg(err?.message || t('adDetailPage.unexpectedError'))
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
            ← {t('adDetailPage.backToMarketplace')}
          </Link>
          <div className="flex items-center gap-3 mt-2">
            <UserAvatar 
              userId={advertiser?.id || (ad as any)?.user_id || (ad as any)?.userId}
              avatarUrl={advertiser?.avatar_url || advertiser?.photo_url || advertiser?.photoURL} 
              photoUrl={advertiser?.photo_url || advertiser?.photoURL}
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
                  ? `${t('adDetailPage.headerSellTo').replace('{asset}', asset)} `
                  : `${t('adDetailPage.headerBuyFrom').replace('{asset}', asset)} `}
                <Link
                  href={`/users/${advertiser?.username || t('counterpartyPanel.fallbackTrader')}`}
                  className="hover:underline text-primary"
                >
                  @{advertiser?.username || t('counterpartyPanel.fallbackTrader')}
                </Link>
              </h1>
            </div>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            {t('tradeInitiation.adId')} <span className="font-mono">{ad.id}</span> • {t('adDetailPage.escrowProtected')}
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
            <span>{fiatCurrency} {t('adDetailPage.unitPrice')}</span>
          </div>
          <span className="text-2xl font-extrabold text-blue-600 dark:text-blue-400 tracking-tight">
            {unitPrice.toLocaleString(language)} {fiatCurrency}/{asset}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="p-5 sm:p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">
              {t('adDetailPage.amountHeading')}
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
                  {isAdvertiserBuyer ? t('adDetailPage.sellAmount').replace('{asset}', asset) : t('adDetailPage.payAmount').replace('{fiat}', fiatCurrency)}
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
                  {t('adDetailPage.receiveAmount').replace('{currency}', isAdvertiserBuyer ? fiatCurrency : asset)}
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

              {/* Payment Method Selector */}
              {paymentMethods.length > 1 && (
                <div>
                  <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                    {t('adDetailPage.selectPaymentMethod')} <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={selectedPaymentMethod}
                    onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                    className="w-full p-3 rounded-xl bg-neutral-50/50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 text-xs font-semibold text-neutral-900 dark:text-neutral-100 focus:ring-2 focus:ring-blue-500 outline-none transition-all cursor-pointer"
                  >
                    {paymentMethods.map((pm, idx) => (
                      <option key={idx} value={pm}>
                        {pm}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Escrow Fee Breakdown */}
              <div className="p-4 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 rounded-xl text-xs space-y-2 font-mono">
                <div className="flex justify-between text-neutral-700 dark:text-neutral-300">
                  <span>{t('adDetailPage.tradeAmount')}</span>
                  <span className="font-bold">{cryptoNum.toLocaleString(language, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} {asset}</span>
                </div>
                <div className="flex justify-between text-neutral-700 dark:text-neutral-300">
                  <span>{t('adDetailPage.escrowFee').replace('{rate}', platformFees ? platformFees.escrowFeePercent.toFixed(2) : '—')}</span>
                  <span className="font-bold">{escrowFeeCrypto.toLocaleString(language, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} {asset}</span>
                </div>
                <div className="flex justify-between font-semibold text-blue-900 dark:text-blue-300 border-t pt-1">
                  <span>{t('adDetailPage.totalLockedWallet')}</span>
                  <span className="font-bold">{totalSellerLock.toLocaleString(language, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} {asset}</span>
                </div>
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-medium pt-0.5">
                  <span>{t('adDetailPage.netReceivedBuyer')}</span>
                  <span className="font-bold">{netReceivedCrypto.toLocaleString(language, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} {asset}</span>
                </div>
              </div>

              <div className="flex flex-wrap justify-between text-xs text-neutral-500 dark:text-neutral-400 px-1 gap-2">
                <span>{t('adDetailPage.orderLimits')} <strong>{Number(ad.min_limit).toLocaleString(language)} – {Number(ad.max_limit).toLocaleString(language)} {fiatCurrency}</strong></span>
                <span>{t('adDetailPage.paymentWindow')} <strong>{ad.payment_window_minutes || ad.payment_window || 30} {t('adDetailPage.minutes')}</strong></span>
              </div>

              <button
                type="button"
                onClick={handleInitiateTrade}
                disabled={isSubmitting || isFeeSettingsLoading || !platformFees || unitPrice <= 0}
                className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-50 text-white font-bold rounded-xl shadow-md transition-all active:scale-[0.99] cursor-pointer"
              >
                {isSubmitting ? t('adDetailPage.initiatingTrade') : isFeeSettingsLoading ? t('adDetailPage.loadingFees') : (isAdvertiserBuyer ? t('adDetailPage.sellNow').replace('{asset}', asset) : t('adDetailPage.buyNow').replace('{asset}', asset))}
              </button>
            </div>
          </div>

          {/* Offer Details */}
          <div className="p-5 sm:p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base text-neutral-800 dark:text-neutral-200">
                {t('adDetailPage.offerTermsMethods')}
              </h3>
              {(ad.offer_label || ad.label) && (
                <span className="text-xs px-2.5 py-0.5 rounded-md font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                  {ad.offer_label || ad.label}
                </span>
              )}
            </div>
            
            <div>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 block mb-2">{t('adDetailPage.acceptedPaymentMethods')}</span>
              <div className="flex flex-wrap gap-2">
                {paymentMethods.length > 0 ? (
                  paymentMethods.map((pm, idx) => (
                    <span key={idx} className="px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                      {pm}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-neutral-400">{t('adDetailPage.noMethodsDefined')}</span>
                )}
              </div>
            </div>

            <div>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 block mb-1.5">{t('adDetailPage.advertiserTerms')}</span>
              <div className="p-3.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-xl text-xs leading-relaxed text-neutral-700 dark:text-neutral-300 border border-neutral-200/60 dark:border-neutral-800 whitespace-pre-wrap">
                {ad.terms || ad.terms_conditions || ad.termsAndConditions || t('adDetailPage.noCustomTerms')}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Trader Info */}
        <div className="p-5 sm:p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm h-fit space-y-5">
          <h3 className="font-semibold text-base border-b pb-3 dark:border-neutral-800 text-neutral-800 dark:text-neutral-200">
            {t('adDetailPage.traderInformation')}
          </h3>

          <div className="flex items-center space-x-3">
            <UserAvatar 
              userId={advertiser?.id || (ad as any)?.user_id || (ad as any)?.userId}
              avatarUrl={advertiser?.avatar_url || advertiser?.photo_url || advertiser?.photoURL} 
              photoUrl={advertiser?.photo_url || advertiser?.photoURL}
              username={advertiser?.username} 
              size="lg" 
            />
            <div>
              <Link 
                href={`/users/${advertiser?.username || t('counterpartyPanel.fallbackTrader')}`}
                className="font-bold text-base text-neutral-900 dark:text-neutral-100 hover:text-primary hover:underline transition-colors block"
              >
                @{advertiser?.username || t('counterpartyPanel.fallbackTrader')}
              </Link>
              <div className="flex items-center space-x-1.5 text-xs mt-0.5">
                <span className={`w-2 h-2 rounded-full ${presence.isOnline ? 'bg-green-500' : 'bg-neutral-400'}`}></span>
                <span className="text-neutral-500 dark:text-neutral-400">{localizedPresenceLabel}</span>
                <span className="text-neutral-400 dark:text-neutral-600">•</span>
                <span className="text-neutral-500 dark:text-neutral-400">{localizedJoinedDate(advertiser?.created_at)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/50 dark:border-neutral-800">
              <span className="text-neutral-500 dark:text-neutral-400 block mb-0.5">{t('adDetailPage.positive')}</span>
              <span className="font-bold text-sm text-green-600 dark:text-green-400">{(stats.positiveFeedbacks || 0).toLocaleString(language)}</span>
              <span className="text-[11px] text-neutral-400 block mt-0.5">{t('adDetailPage.positivePercent').replace('{percent}', Number(positivePercentage).toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))}</span>
            </div>

            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/50 dark:border-neutral-800">
              <span className="text-neutral-500 dark:text-neutral-400 block mb-0.5">{t('adDetailPage.negative')}</span>
              <span className="font-bold text-sm text-red-600 dark:text-red-400">{(stats.negativeFeedbacks || 0).toLocaleString(language)}</span>
              <span className="text-[11px] text-neutral-400 block mt-0.5">{t('adDetailPage.totalTrades').replace('{count}', (stats.totalTrades || 0).toLocaleString(language))}</span>
            </div>

            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/50 dark:border-neutral-800">
              <span className="text-neutral-500 dark:text-neutral-400 block mb-0.5">{t('adDetailPage.avgPayTime')}</span>
              <span className="font-bold text-sm">{formatSeconds(stats.avgPaySeconds)}</span>
              <span className="text-[11px] text-neutral-400 block mt-0.5">{t('adDetailPage.buyerSpeedMetric')}</span>
            </div>

            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/50 dark:border-neutral-800">
              <span className="text-neutral-500 dark:text-neutral-400 block mb-0.5">{t('adDetailPage.avgRelease')}</span>
              <span className="font-bold text-sm">{formatSeconds(stats.avgReleaseSeconds)}</span>
              <span className="text-[11px] text-neutral-400 block mt-0.5">{t('adDetailPage.sellerReleaseSpeed')}</span>
            </div>

            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/50 dark:border-neutral-800">
              <span className="text-neutral-500 dark:text-neutral-400 block mb-0.5">{t('adDetailPage.blockedBy')}</span>
              <span className="font-bold text-sm">{(stats.blockedBy || 0).toLocaleString(language)}</span>
              <span className="text-[11px] text-neutral-400 block mt-0.5">{t('adDetailPage.traders')}</span>
            </div>

            <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/50 dark:border-neutral-800">
              <span className="text-neutral-500 dark:text-neutral-400 block mb-0.5">{t('adDetailPage.hasBlocked')}</span>
              <span className="font-bold text-sm">{(stats.hasBlocked || 0).toLocaleString(language)}</span>
              <span className="text-[11px] text-neutral-400 block mt-0.5">{t('adDetailPage.traders')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
