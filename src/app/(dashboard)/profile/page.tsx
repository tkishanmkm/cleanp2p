'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { getPublicHandle, formatCurrencyValue } from '@/utils/userPrivacy';
import { ShieldCheck, User, Clock, Award, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AccountData {
  full_name: string;
  username: string;
  preferred_fiat: string;
  total_volume: number;
  completed_trades: number;
  avg_payment_time: number;
  avg_release_time: number;
  dob?: string;
}

export default function PrivateAccountView() {
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPrivateProfile() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          // Fetch profile
          const { data: profile } = await supabase
            .from('profiles')
            .select('username, full_name, preferred_fiat, dob')
            .eq('id', user.id)
            .maybeSingle();

          // RPC call for performance summary if available
          let stats: any = {};
          try {
            const { data: summary } = await supabase.rpc('get_private_account_summary', {
              user_id_param: user.id,
            });
            stats = summary?.[0] || {};
          } catch {
            // Fallback to table query if RPC is not present
            const { data: st } = await supabase
              .from('user_trading_stats')
              .select('*')
              .eq('user_id', user.id)
              .maybeSingle();
            if (st) {
              stats = {
                total_volume_inr: st.total_trade_volume || 0,
                completed_trades_count: st.completed_trades || 0,
                avg_payment_time_min: Math.round((st.avg_payment_seconds || 240) / 60),
                avg_release_time_min: Math.round((st.avg_release_seconds || 120) / 60),
              };
            }
          }

          setAccount({
            full_name: profile?.full_name || user.user_metadata?.full_name || profile?.username || 'Verified User',
            username: profile?.username || user.user_metadata?.username || 'pulsepost949',
            preferred_fiat: profile?.preferred_fiat || 'INR',
            total_volume: stats.total_volume_inr || 0,
            completed_trades: stats.completed_trades_count || 0,
            avg_payment_time: stats.avg_payment_time_min || 0,
            avg_release_time: stats.avg_release_time_min || 0,
            dob: profile?.dob || 'Not provided',
          });
        }
      } catch (err) {
        console.error('Failed to load private account view:', err);
      } finally {
        setLoading(false);
      }
    }

    loadPrivateProfile();
  }, []);

  if (loading) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground">Loading private account details...</span>
      </div>
    );
  }

  if (!account) {
    return <div className="p-8 text-center text-red-500 font-medium">Please sign in to view your private profile.</div>;
  }

  const publicHandle = getPublicHandle(account.username);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Account Owner Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-6 bg-card border rounded-2xl gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">Account Owner</h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              Private View
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Logged in as <span className="font-bold text-foreground">{publicHandle}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
          <ShieldCheck className="h-4 w-4" />
          <span>Escrow Protected Account</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Private User Information */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4 text-primary" /> Private User Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Full Legal Name</span>
              <span className="font-semibold text-foreground">{account.full_name}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Date of Birth</span>
              <span className="font-medium text-muted-foreground">{account.dob}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Preferred Fiat Currency</span>
              <span className="font-bold text-primary">{account.preferred_fiat} (₹)</span>
            </div>
          </CardContent>
        </Card>

        {/* Trading Performance Summary */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="h-4 w-4 text-primary" /> Trading Performance Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Total Volume</span>
              <span className="font-bold text-foreground">
                {formatCurrencyValue(account.total_volume, account.preferred_fiat)}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Completed Trades</span>
              <span className="font-semibold text-foreground">{account.completed_trades}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Avg. Payment Time</span>
              <span className="font-medium text-foreground">{account.avg_payment_time} min</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-muted-foreground">Avg. Release Time</span>
              <span className="font-medium text-foreground">{account.avg_release_time} min</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Escrow Footer Note */}
      <div className="p-4 rounded-xl bg-muted/50 border text-xs text-center text-muted-foreground">
        Trade with confidence. Paxones provides a secure P2P platform with a trusted escrow system.
      </div>
    </div>
  );
}
