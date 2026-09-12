"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShieldCheck, 
  Award, 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  ArrowUpRight, 
  DollarSign, 
  Coins, 
  Loader2, 
  AlertTriangle,
  UserCheck,
  Zap,
  TrendingUp,
  RefreshCw,
  Lock,
  Unlock
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { createClient } from '@/lib/supabase/client';
import { MERCHANT_TIERS, type MerchantTier } from '@/lib/merchant';
import { MerchantBadge } from '@/components/merchant/merchant-badge';

export default function AdminMerchantsPage() {
  const { toast } = useToast();
  const supabase = createClient();
  const [merchants, setMerchants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('ALL');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [updating, setUpdating] = useState(false);

  const loadMerchants = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id,
          username,
          email,
          merchant_tier,
          merchant_deposit_usdt,
          merchant_applied_tier,
          merchant_status,
          total_volume_usd,
          completed_trades,
          positive_feedback,
          negative_feedback,
          kyc_status,
          created_at
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setMerchants(data || []);
    } catch (err: any) {
      console.error('Error loading merchants:', err);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load merchant data.' });
    } finally {
      setLoading(false);
    }
  }, [supabase, toast]);

  useEffect(() => {
    loadMerchants();
  }, [loadMerchants]);

  const handleUpdateTier = async (userId: string, newTier: string | null, deposit: number) => {
    setUpdating(true);
    try {
      const res = await fetch('/api/admin/merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          tier: newTier,
          depositUsdt: deposit,
          status: newTier ? 'APPROVED' : 'NONE',
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update tier');
      }

      toast({
        title: 'Merchant Tier Updated',
        description: `User tier successfully updated to ${newTier || 'Standard'}.`,
      });
      loadMerchants();
      setSelectedUser(null);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Update Failed', description: err.message });
    } finally {
      setUpdating(false);
    }
  };

  const filteredMerchants = merchants.filter((m) => {
    const matchesSearch = 
      (m.username || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.id || '').includes(searchQuery);

    if (!matchesSearch) return false;

    if (tierFilter === 'ALL') return true;
    if (tierFilter === 'MERCHANTS_ONLY') return Boolean(m.merchant_tier && m.merchant_tier !== 'STANDARD');
    if (tierFilter === 'APPLICATIONS') return Boolean(m.merchant_applied_tier && m.merchant_status === 'PENDING');
    return m.merchant_tier === tierFilter;
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2.5">
            <Award className="h-7 w-7 text-amber-500" />
            <span>Merchant Tier Engine & Approvals</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Review security deposits, volume thresholds, and authorize Gold, Diamond, and Elite verified merchant badges.
          </p>
        </div>

        <Button onClick={loadMerchants} variant="outline" size="sm" className="border-slate-700 text-xs">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh List
        </Button>
      </div>

      {/* Overview Tier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Object.entries(MERCHANT_TIERS)
          .filter(([key]) => key !== 'NONE')
          .map(([key, info]) => (
          <Card key={key} className="bg-slate-900/90 border-slate-800 text-slate-100">
            <CardHeader className="pb-2">
              <div className="flex justify-between items-center">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <MerchantBadge tier={key as MerchantTier} size="md" />
                  <span>{info.label}</span>
                </CardTitle>
                <Badge variant="outline" className="border-amber-500/30 text-amber-400 font-mono text-xs">
                  {(info.requiredDepositUsdt || 0).toLocaleString()} USDT Bond
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-slate-400">
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span>Min Trading Volume:</span>
                <span className="font-semibold text-slate-200">${(info.requiredVolumeUsd || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span>Tier Level:</span>
                <span className="font-semibold text-amber-400 font-mono">{key}</span>
              </div>
              <div className="flex justify-between py-1">
                <span>Priority:</span>
                <span className="font-semibold text-emerald-400">HIGH PRIORITY DESK</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-slate-900 p-4 rounded-2xl border border-slate-800">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search by username, email, ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-slate-950 border-slate-800 text-xs h-9"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-slate-400" />
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="w-48 bg-slate-950 border-slate-800 text-xs h-9">
              <SelectValue placeholder="Filter Tier" />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
              <SelectItem value="ALL">All Traders</SelectItem>
              <SelectItem value="MERCHANTS_ONLY">Active Merchants Only</SelectItem>
              <SelectItem value="APPLICATIONS">Pending Applications</SelectItem>
              <SelectItem value="GOLD">Gold Tier</SelectItem>
              <SelectItem value="DIAMOND">Diamond Tier</SelectItem>
              <SelectItem value="ELITE">Elite Tier</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Merchants Table */}
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-slate-400">
              <Loader2 className="h-8 w-8 text-amber-500 animate-spin" />
              <p className="text-xs">Loading merchant registry...</p>
            </div>
          ) : filteredMerchants.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-sm">
              No traders found matching the filter criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase font-semibold">
                  <tr>
                    <th className="p-3.5">Trader</th>
                    <th className="p-3.5">Current Tier</th>
                    <th className="p-3.5">Locked Deposit</th>
                    <th className="p-3.5">Trade Volume</th>
                    <th className="p-3.5">KYC Status</th>
                    <th className="p-3.5">Completed Trades</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {filteredMerchants.map((m) => {
                    const hasTier = m.merchant_tier && m.merchant_tier !== 'STANDARD';
                    const isPending = m.merchant_applied_tier && m.merchant_status === 'PENDING';

                    return (
                      <tr key={m.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="p-3.5">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <span>@{m.username || 'unnamed'}</span>
                            {isPending && (
                              <Badge variant="outline" className="bg-amber-500/10 border-amber-500/30 text-amber-400 text-[10px]">
                                Applied for {m.merchant_applied_tier}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 font-mono">{m.email || m.id.slice(0, 10)}</p>
                        </td>

                        <td className="p-3.5">
                          {hasTier ? (
                            <MerchantBadge tier={m.merchant_tier} size="md" />
                          ) : (
                            <span className="text-slate-500">Standard</span>
                          )}
                        </td>

                        <td className="p-3.5 font-mono font-semibold text-amber-400">
                          {m.merchant_deposit_usdt ? `${Number(m.merchant_deposit_usdt).toLocaleString()} USDT` : '0 USDT'}
                        </td>

                        <td className="p-3.5 font-mono text-slate-200">
                          ${Number(m.total_volume_usd || 0).toLocaleString()}
                        </td>

                        <td className="p-3.5">
                          <Badge 
                            variant="outline" 
                            className={
                              m.kyc_status === 'VERIFIED' || m.kyc_status === 'APPROVED'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }
                          >
                            {m.kyc_status || 'UNVERIFIED'}
                          </Badge>
                        </td>

                        <td className="p-3.5">
                          <span className="font-bold text-slate-200">{m.completed_trades || 0}</span>
                          <span className="text-[10px] text-slate-500 ml-1">({m.positive_feedback || 0}+ / {m.negative_feedback || 0}-)</span>
                        </td>

                        <td className="p-3.5 text-right space-x-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px] border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                            onClick={() => setSelectedUser(m)}
                          >
                            Manage Tier
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manage Tier Modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full space-y-5 shadow-2xl text-slate-100">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="font-black text-lg text-white flex items-center gap-2">
                <Award className="h-5 w-5 text-amber-500" />
                <span>Manage Merchant Tier: @{selectedUser.username}</span>
              </h3>
              <button 
                type="button"
                onClick={() => setSelectedUser(null)} 
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl space-y-1">
                <p className="text-slate-400">Current Status: <span className="font-bold text-white">{selectedUser.merchant_tier || 'Standard'}</span></p>
                <p className="text-slate-400">Current Deposit: <span className="font-bold text-amber-400">{selectedUser.merchant_deposit_usdt || 0} USDT</span></p>
                <p className="text-slate-400">Trade Volume: <span className="font-bold text-slate-200">${Number(selectedUser.total_volume_usd || 0).toLocaleString()}</span></p>
              </div>

              <div className="space-y-2">
                <label className="font-bold text-slate-300 block">Select Merchant Tier Authority</label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant={selectedUser.merchant_tier === 'GOLD' ? 'default' : 'outline'}
                    className="flex flex-col h-auto py-2.5 border-amber-500/30"
                    disabled={updating}
                    onClick={() => handleUpdateTier(selectedUser.id, 'GOLD', 1000)}
                  >
                    <MerchantBadge tier="GOLD" size="sm" />
                    <span className="text-[10px] mt-1 text-slate-400">1,000 USDT</span>
                  </Button>

                  <Button
                    type="button"
                    variant={selectedUser.merchant_tier === 'DIAMOND' ? 'default' : 'outline'}
                    className="flex flex-col h-auto py-2.5 border-cyan-500/30"
                    disabled={updating}
                    onClick={() => handleUpdateTier(selectedUser.id, 'DIAMOND', 10000)}
                  >
                    <MerchantBadge tier="DIAMOND" size="sm" />
                    <span className="text-[10px] mt-1 text-slate-400">10,000 USDT</span>
                  </Button>

                  <Button
                    type="button"
                    variant={selectedUser.merchant_tier === 'ELITE' ? 'default' : 'outline'}
                    className="flex flex-col h-auto py-2.5 border-purple-500/30"
                    disabled={updating}
                    onClick={() => handleUpdateTier(selectedUser.id, 'ELITE', 50000)}
                  >
                    <MerchantBadge tier="ELITE" size="sm" />
                    <span className="text-[10px] mt-1 text-slate-400">50,000 USDT</span>
                  </Button>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex justify-between gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="text-xs"
                  disabled={updating}
                  onClick={() => handleUpdateTier(selectedUser.id, null, 0)}
                >
                  Revoke Merchant Tier
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs border-slate-700"
                  onClick={() => setSelectedUser(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
