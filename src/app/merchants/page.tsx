"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Award, 
  ShieldCheck, 
  CheckCircle2, 
  Sparkles, 
  TrendingUp, 
  Lock, 
  ArrowRight, 
  Zap, 
  ShieldAlert, 
  Coins, 
  Users, 
  Scale, 
  FileText,
  Loader2
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/components/providers/auth-provider';
import { MERCHANT_TIERS, type MerchantTier } from '@/lib/merchant';
import { MerchantBadge } from '@/components/merchant/merchant-badge';
import { createClient } from '@/lib/supabase/client';

export default function MerchantsProgramPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const supabase = createClient();

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [applyingTier, setApplyingTier] = useState<string | null>(null);

  useEffect(() => {
    async function loadUserMerchantStatus() {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id, username, merchant_tier, merchant_deposit_usdt, merchant_applied_tier, merchant_status, kyc_status, total_volume_usd')
          .eq('id', user.id)
          .maybeSingle();
        setProfile(data);
      } catch (err) {
        console.error('Error loading merchant profile:', err);
      } finally {
        setLoading(false);
      }
    }
    loadUserMerchantStatus();
  }, [user, supabase]);

  const handleApply = async (tierKey: string) => {
    if (!user) {
      toast({
        variant: 'destructive',
        title: 'Authentication Required',
        description: 'Please sign in to apply for Paxones Verified Merchant status.',
      });
      return;
    }

    setApplyingTier(tierKey);
    try {
      const res = await fetch('/api/user/merchant-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetTier: tierKey }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit application');

      toast({
        title: 'Application Submitted',
        description: data.message,
      });

      setProfile((prev: any) => ({
        ...prev,
        merchant_applied_tier: tierKey,
        merchant_status: 'PENDING',
      }));
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Application Error', description: err.message });
    } finally {
      setApplyingTier(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 sm:py-12 space-y-12">
      {/* Hero Header */}
      <div className="text-center space-y-4 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-bold">
          <Award className="h-4 w-4" />
          <span>PaxOnes Verified Merchant Program</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">
          Accelerate Your P2P Volume with Verified Trust
        </h1>

        <p className="text-sm sm:text-base text-slate-600 dark:text-slate-300 leading-relaxed font-normal">
          Lock in exclusive merchant badges, priority ad placement, enhanced active listing limits, 
          and dedicated dispute concierges designed for high-frequency liquidity providers.
        </p>

        {profile?.merchant_tier && (
          <div className="pt-2 flex items-center justify-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Your Current Status:</span>
            <MerchantBadge tier={profile.merchant_tier} size="md" />
          </div>
        )}
      </div>

      {/* Tier Comparison Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {Object.entries(MERCHANT_TIERS)
          .filter(([key]) => key !== 'NONE')
          .map(([key, info]) => {
            const isCurrentTier = profile?.merchant_tier === key;
            const isPending = profile?.merchant_applied_tier === key && profile?.merchant_status === 'PENDING';

            return (
              <Card 
                key={key} 
                className={`rounded-3xl border transition-all duration-200 flex flex-col justify-between ${
                  key === 'DIAMOND' 
                    ? 'border-cyan-500/50 dark:bg-[#0c1322] shadow-xl relative' 
                    : 'border-slate-200 dark:border-[#1e2640] bg-white dark:bg-[#0f1423]'
                }`}
              >
                {key === 'DIAMOND' && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-cyan-500 text-slate-950 font-black text-[10px] uppercase tracking-wider shadow-md">
                    Most Popular
                  </div>
                )}

                <CardHeader className="p-6 pb-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <MerchantBadge tier={key as MerchantTier} size="md" />
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      {key === 'ELITE' ? 'VIP Desk' : key === 'DIAMOND' ? 'Priority Support' : 'Fast-Track'}
                    </span>
                  </div>

                  <div>
                    <CardTitle className="text-2xl font-black text-slate-900 dark:text-white">
                      {info.label}
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Ideal for {key === 'GOLD' ? 'growing volume traders' : key === 'DIAMOND' ? 'established liquidity desks' : 'institutional market makers'}.
                    </CardDescription>
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-xs font-medium text-slate-400">Security Deposit Bond:</p>
                    <p className="text-3xl font-black text-amber-500 mt-0.5 font-mono">
                      {(info.requiredDepositUsdt || 0).toLocaleString()} <span className="text-base text-slate-400 font-sans">USDT</span>
                    </p>
                  </div>
                </CardHeader>

                <CardContent className="p-6 pt-0 space-y-3 text-xs">
                  <div className="space-y-2.5 pt-2">
                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span><strong>${(info.requiredVolumeUsd || 0).toLocaleString()}</strong> 30-day volume target</span>
                    </div>
                    {info.perks?.map((perk, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        <span>{perk}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>

                <CardFooter className="p-6 pt-0">
                  {isCurrentTier ? (
                    <Button disabled className="w-full bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/30">
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Active Tier
                    </Button>
                  ) : isPending ? (
                    <Button disabled className="w-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/30">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Application Under Review
                    </Button>
                  ) : (
                    <Button 
                      onClick={() => handleApply(key)}
                      disabled={applyingTier === key}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md cursor-pointer transition-colors"
                    >
                      {applyingTier === key ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Locking Deposit & Applying...</>
                      ) : (
                        <>Lock {info.requiredDepositUsdt} USDT & Activate {info.label} <ArrowRight className="ml-1.5 h-4 w-4" /></>
                      )}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
      </div>

      {/* Merchant Security & Legal Terms Notice */}
      <div className="rounded-3xl p-6 sm:p-8 bg-white dark:bg-[#0f1423] border border-slate-200 dark:border-[#1e2640] shadow-sm space-y-4">
        <div className="flex items-center gap-3 text-slate-900 dark:text-white">
          <ShieldAlert className="h-6 w-6 text-amber-500" />
          <h2 className="text-xl font-bold">Merchant Security Deposit & Legal Terms</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <div className="space-y-2 p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800">
            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-amber-500" /> Deposit Custody & Refundability
            </h3>
            <p>
              Security deposits remain in segregated cold escrow wallets. Merchants may request deposit release after a 
              14-day cooling period following the closure of all active marketplace ads and open trade disputes.
            </p>
          </div>

          <div className="space-y-2 p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-100 dark:border-slate-800">
            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 text-blue-500" /> Dispute Integrity & Forfeiture Rules
            </h3>
            <p>
              Intentional coin locking, payment chargebacks, third-party payment fraud, or off-platform contact sharing 
              will result in immediate badge revocation and potential forfeiture of the merchant security bond.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
