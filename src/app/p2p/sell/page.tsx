'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { FlagIcon } from '@/components/ui/flag-icon';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { FIAT_CURRENCIES, getCurrencyCountryCode } from '@/lib/currencies';
import type { CryptoCurrency } from '@/lib/types';
import {
  Search,
  Filter,
  ArrowRight,
  ShieldCheck,
  Clock,
  ThumbsUp,
  AlertCircle,
  Loader2,
  RefreshCw,
  CreditCard,
  ChevronDown,
  Layers,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface P2PAd {
  id: string;
  user_id: string;
  user_display_name?: string;
  side: string; // 'BUY' or 'SELL'
  type?: string;
  crypto_currency: string;
  asset?: string;
  fiat_currency: string;
  fiat?: string;
  price: number;
  min_limit?: number;
  max_limit?: number;
  total_amount?: number;
  available_amount?: number;
  status?: string;
  terms?: string;
  payment_methods?: string[] | string;
  created_at?: string;
  profiles?: {
    username: string;
    full_name?: string;
    avatar_url?: string;
    completed_trades?: number;
    positive_feedback?: number;
    negative_feedback?: number;
  };
}

const SUPPORTED_COINS: { symbol: CryptoCurrency; name: string }[] = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'USDT', name: 'Tether' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'LTC', name: 'Litecoin' },
];

function CoinIcon({ symbol, className = 'w-5 h-5' }: { symbol: string; className?: string }) {
  const s = symbol?.toUpperCase();
  if (s === 'BTC') return <BtcLogo className={className} />;
  if (s === 'USDT') return <UsdtLogo className={className} />;
  if (s === 'ETH') return <EthLogo className={className} />;
  if (s === 'LTC') return <LtcLogo className={className} />;
  return <div className={`${className} rounded-full bg-[#9273FC]/20 text-[#9273FC] flex items-center justify-center font-bold text-xs`}>{s?.slice(0, 2)}</div>;
}

export default function SellPageMarketplace() {
  const [ads, setAds] = useState<P2PAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filters
  const [selectedCrypto, setSelectedCrypto] = useState<string>('ALL');
  const [selectedFiat, setSelectedFiat] = useState<string>('ALL');
  const [searchAmount, setSearchAmount] = useState<string>('');

  const supabase = useMemo(() => createClient(), []);

  const fetchSellableAds = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [{ data: p2pData }, { data: adsData }] = await Promise.all([
        supabase.from('p2p_ads').select('*').order('created_at', { ascending: false }),
        supabase.from('ads').select('*').order('created_at', { ascending: false }),
      ]);

      const mapById = new Map<string, any>();
      (p2pData || []).forEach((row: any) => { if (row?.id) mapById.set(row.id, row); });
      (adsData || []).forEach((row: any) => { if (row?.id && !mapById.has(row.id)) mapById.set(row.id, row); });
      const rawAds = Array.from(mapById.values());

      // Fetch user profiles separately
      const userIds = Array.from(new Set(rawAds.map((a: any) => a.user_id).filter(Boolean)));
      let profilesMap: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, full_name, avatar_url, photo_url, completed_trades, positive_feedback, negative_feedback')
          .in('id', userIds);
        if (profiles) {
          profiles.forEach((p: any) => {
            profilesMap[p.id] = p;
          });
        }
      }

      // Normalize ad fields
      const formatted: P2PAd[] = rawAds
        .filter((item: any) => item.active !== false && item.status !== 'INACTIVE' && item.status !== 'DELETED')
        .map((item: any) => {
          const profile = profilesMap[item.user_id];
          const resolvedAvatar = profile?.avatar_url || profile?.photo_url || (item.user_id ? `/api/media/avatar/${item.user_id}` : null);
          return {
            ...item,
            side: item.side || item.type || 'BUY',
            crypto_currency: (item.crypto_currency || item.crypto || item.asset || item.coin || 'BTC').toUpperCase(),
            fiat_currency: (item.fiat_currency || item.fiat || 'USD').toUpperCase(),
            price: Number(item.price || 0),
            profiles: profile
              ? {
                  ...profile,
                  avatar_url: resolvedAvatar,
                  photo_url: resolvedAvatar,
                }
              : {
                  username: item.user_display_name || 'Trader',
                  avatar_url: resolvedAvatar,
                  photo_url: resolvedAvatar,
                  completed_trades: 0,
                  positive_feedback: 0,
                  negative_feedback: 0,
                },
          };
        });

      // Filter to ads where taker can sell (side === 'BUY') or user's own created ads
      const sellable = formatted.filter(
        (ad) => ad.side?.toUpperCase() === 'BUY' || (ad as any).type?.toUpperCase() === 'BUY' || (currentUserId && ad.user_id === currentUserId) || formatted.length <= 4
      );

      setAds(sellable.length > 0 ? sellable : formatted);
    } catch (err: any) {
      console.error('Error fetching sell ads:', err);
      setErrorMsg(err.message || 'Failed to fetch peer-to-peer sell advertisements.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSellableAds();
  }, []);

  // Filtered ads
  const filteredAds = useMemo(() => {
    return ads.filter((ad) => {
      // Crypto filter
      if (selectedCrypto !== 'ALL' && ad.crypto_currency?.toUpperCase() !== selectedCrypto) {
        return false;
      }
      // Fiat filter
      if (selectedFiat !== 'ALL' && ad.fiat_currency?.toUpperCase() !== selectedFiat) {
        return false;
      }
      // Amount filter
      if (searchAmount && !isNaN(Number(searchAmount))) {
        const amt = Number(searchAmount);
        const min = Number(ad.min_limit || 0);
        const max = Number(ad.max_limit || Infinity);
        if (amt < min || amt > max) return false;
      }
      return true;
    });
  }, [ads, selectedCrypto, selectedFiat, searchAmount]);

  const availableFiats = useMemo(() => {
    const set = new Set<string>();
    ads.forEach((a) => {
      if (a.fiat_currency) set.add(a.fiat_currency.toUpperCase());
    });
    return Array.from(set);
  }, [ads]);

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border pb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-[#9273FC]/10 text-[#9273FC] border-[#9273FC]/30 text-xs font-semibold px-2.5 py-0.5">
                P2P Trading
              </Badge>
              <span className="text-xs text-muted-foreground">• Escrow Protected</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              Sell Crypto Online
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Sell Bitcoin, USDT, and cryptocurrencies for your preferred local fiat currency.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={fetchSellableAds}
              variant="outline"
              size="sm"
              className="border-border text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Link href="/ads/create">
              <Button
                size="sm"
                className="bg-[#9273FC] hover:bg-[#8261FA] text-white text-xs font-bold shadow-md shadow-[#9273FC]/25"
              >
                + Post Sell Ad
              </Button>
            </Link>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="bg-card p-4 sm:p-5 rounded-2xl border border-border shadow-sm space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground mr-1">Crypto:</span>
            <Button
              key="ALL_COINS"
              size="sm"
              variant={selectedCrypto === 'ALL' ? 'default' : 'outline'}
              onClick={() => setSelectedCrypto('ALL')}
              className={cn(
                'text-xs rounded-xl h-8 px-3 transition-all',
                selectedCrypto === 'ALL'
                  ? 'bg-[#9273FC] text-white hover:bg-[#8261FA]'
                  : 'border-border text-foreground hover:bg-muted'
              )}
            >
              All Coins
            </Button>
            {SUPPORTED_COINS.map((c) => (
              <Button
                key={c.symbol}
                size="sm"
                variant={selectedCrypto === c.symbol ? 'default' : 'outline'}
                onClick={() => setSelectedCrypto(c.symbol)}
                className={cn(
                  'text-xs rounded-xl h-8 px-3 flex items-center gap-1.5 transition-all',
                  selectedCrypto === c.symbol
                    ? 'bg-[#9273FC] text-white hover:bg-[#8261FA]'
                    : 'border-border text-foreground hover:bg-muted'
                )}
              >
                <CoinIcon symbol={c.symbol} className="w-3.5 h-3.5" />
                <span>{c.symbol}</span>
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border/50">
            {/* Amount search */}
            <div className="relative">
              <Input
                type="number"
                placeholder="Enter amount to sell..."
                value={searchAmount}
                onChange={(e) => setSearchAmount(e.target.value)}
                className="h-10 text-xs rounded-xl border-border bg-background focus-visible:ring-[#9273FC]"
              />
            </div>

            {/* Fiat selection */}
            <div>
              <select
                value={selectedFiat}
                onChange={(e) => setSelectedFiat(e.target.value)}
                className="w-full h-10 px-3 text-xs rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-[#9273FC]"
              >
                <option value="ALL">All Currencies</option>
                {availableFiats.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            {/* Reset Filters */}
            <div className="flex items-center">
              {(selectedCrypto !== 'ALL' || selectedFiat !== 'ALL' || searchAmount) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedCrypto('ALL');
                    setSelectedFiat('ALL');
                    setSearchAmount('');
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground h-10"
                >
                  Clear Filters
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Ads Listing Table / Cards */}
        {loading ? (
          <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
            <Loader2 className="w-8 h-8 animate-spin text-[#9273FC]" />
            <span>Finding active sell offers...</span>
          </div>
        ) : errorMsg ? (
          <div className="p-6 rounded-2xl bg-destructive/10 border border-destructive/30 text-destructive text-sm text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-2" />
            <p className="font-semibold">{errorMsg}</p>
            <Button
              onClick={fetchSellableAds}
              variant="outline"
              size="sm"
              className="mt-3 border-destructive/40 text-destructive"
            >
              Try Again
            </Button>
          </div>
        ) : filteredAds.length === 0 ? (
          <div className="bg-card p-12 rounded-2xl border border-border text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-foreground">No Offers Found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              No active offers match your current filter criteria. Try clearing filters or create your own ad.
            </p>
            <Link href="/ads/create">
              <Button className="mt-2 bg-[#9273FC] hover:bg-[#8261FA] text-white text-xs font-semibold">
                Create an Ad Now
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAds.map((ad) => {
              // Privacy mandate: Strictly display only username everywhere
              const traderUsername =
                ad.profiles?.username || ad.user_display_name || 'trader';
              const positiveReviews = ad.profiles?.positive_feedback ?? 0;
              const completedTrades = ad.profiles?.completed_trades ?? 0;

              // Payment methods
              const pms = Array.isArray(ad.payment_methods)
                ? ad.payment_methods
                : typeof ad.payment_methods === 'string'
                ? [ad.payment_methods]
                : ['Bank Transfer'];

              const flagCode = getCurrencyCountryCode(ad.fiat_currency);

              return (
                <div
                  key={ad.id}
                  className="bg-card p-4 sm:p-5 rounded-2xl border border-border hover:border-[#9273FC]/40 transition-all shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  {/* Trader Info (Username only) */}
                  <div className="flex items-center gap-3.5 min-w-[200px]">
                    <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center font-bold text-sm text-muted-foreground border border-border shrink-0">
                      {traderUsername.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        {/* Only username displayed */}
                        <span className="font-bold text-sm text-foreground">
                          @{traderUsername}
                        </span>
                        <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        <span>{completedTrades} trades</span>
                        <span>•</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-0.5">
                          <ThumbsUp className="w-3 h-3" /> {positiveReviews}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Price & Limits */}
                  <div className="space-y-1 md:min-w-[180px]">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-lg sm:text-xl font-extrabold font-mono text-foreground">
                        {ad.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <div className="flex items-center gap-1 text-xs font-bold text-muted-foreground">
                        <FlagIcon countryCode={flagCode} className="h-3 w-4 rounded-xs" />
                        <span>{ad.fiat_currency}</span>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      Limit: {Number(ad.min_limit || 0).toLocaleString()} - {Number(ad.max_limit || 0).toLocaleString()} {ad.fiat_currency}
                    </div>
                  </div>

                  {/* Payment Methods */}
                  <div className="flex flex-wrap gap-1.5 max-w-xs">
                    {pms.slice(0, 3).map((pm, idx) => (
                      <Badge
                        key={idx}
                        variant="outline"
                        className="text-[11px] font-medium border-border/80 bg-muted/40"
                      >
                        {pm}
                      </Badge>
                    ))}
                    {pms.length > 3 && (
                      <Badge variant="outline" className="text-[11px] border-border text-muted-foreground">
                        +{pms.length - 3}
                      </Badge>
                    )}
                  </div>

                  {/* Action CTA */}
                  <div className="shrink-0 flex items-center justify-end">
                    <Link href={`/ad/${ad.id}`}>
                      <Button
                        size="sm"
                        className="bg-[#9273FC] hover:bg-[#8261FA] text-white font-bold text-xs rounded-xl px-5 h-10 shadow-md shadow-[#9273FC]/25 flex items-center gap-1.5 group"
                      >
                        <span>Sell {ad.crypto_currency}</span>
                        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
