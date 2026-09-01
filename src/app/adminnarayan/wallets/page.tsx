'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { getAdminWalletOverview, type AdminWalletMetrics } from '@/lib/supabase/db';
import { checkSupabaseConfig, supabase } from '@/lib/supabase/client';
import {
  Wallet,
  Coins,
  Layers,
  ShieldCheck,
  RefreshCw,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
  Copy,
  Shield,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';

function CryptoIconBadge({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  switch (name?.toUpperCase()) {
    case 'BTC':
      return <BtcLogo className={className} />;
    case 'ETH':
      return <EthLogo className={className} />;
    case 'LTC':
      return <LtcLogo className={className} />;
    case 'USDT':
      return <UsdtLogo className={className} />;
    default:
      return <Coins className={className} />;
  }
}

export default function AdminWalletsPage() {
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metrics, setMetrics] = useState<AdminWalletMetrics>({
    totalWallets: 0,
    totalBalances: {
      BTC: { available: 0, locked_escrow: 0, locked_withdrawal: 0 },
      ETH: { available: 0, locked_escrow: 0, locked_withdrawal: 0 },
      LTC: { available: 0, locked_escrow: 0, locked_withdrawal: 0 },
      USDT: { available: 0, locked_escrow: 0, locked_withdrawal: 0 },
    },
    provisioningQueue: {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total_users: 0,
      provisioned_wallets: 0,
    },
    platformWallets: [],
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  const fetchMetrics = async () => {
    try {
      const { data, error } = await getAdminWalletOverview();
      if (data && data.totalWallets > 0) {
        setMetrics(data);
      } else {
        const { data: usersData } = await supabase
          .from('profiles')
          .select('id, username, is_admin, role, btc_balance, eth_balance, ltc_balance, usdt_balance');

        if (usersData) {
          const regularUsers = usersData.filter((u: any) => !u.is_admin && u.role !== 'admin');
          const totalUsers = regularUsers.length;

          let totalBTC = 0,
            totalETH = 0,
            totalLTC = 0,
            totalUSDT = 0;

          regularUsers.forEach((u: any) => {
            totalBTC += Number(u.btc_balance || 0);
            totalETH += Number(u.eth_balance || 0);
            totalLTC += Number(u.ltc_balance || 0);
            totalUSDT += Number(u.usdt_balance || 0);
          });

          setMetrics((prev) => ({
            ...prev,
            totalWallets: totalUsers,
            totalBalances: {
              BTC: { available: totalBTC, locked_escrow: 0, locked_withdrawal: 0 },
              ETH: { available: totalETH, locked_escrow: 0, locked_withdrawal: 0 },
              LTC: { available: totalLTC, locked_escrow: 0, locked_withdrawal: 0 },
              USDT: { available: totalUSDT, locked_escrow: 0, locked_withdrawal: 0 },
            },
            provisioningQueue: {
              queued: 0,
              processing: 0,
              completed: totalUsers,
              failed: 0,
              total_users: totalUsers,
              provisioned_wallets: totalUsers,
            },
          }));
        }
      }
    } catch (err) {
      console.error('Error fetching admin wallet metrics:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isAdminLoading && isAdmin) {
      fetchMetrics();
    }
  }, [isAdmin, isAdminLoading]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchMetrics();
    toast({ title: 'Refreshed', description: 'Wallet metrics and queue statuses updated.' });
  };

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr);
    toast({ title: 'Copied', description: 'Address copied to clipboard' });
  };

  const filteredPlatformWallets = metrics.platformWallets.filter(
    (pw) =>
      pw.asset_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pw.network_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pw.public_address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      pw.wallet_type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const supabaseConfig = checkSupabaseConfig();

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Wallets & Custody Overview</h1>
          <p className="text-sm text-muted-foreground">
            System operational metrics, multi-currency ledger balances, and address provisioning queues.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing || loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh Metrics
          </Button>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total User Wallets</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? '...' : metrics.totalWallets}</div>
            <p className="text-xs text-muted-foreground mt-1">Active ledger accounts registered</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Provisioning Queue</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">
              {loading
                ? '...'
                : `${metrics.provisioningQueue.completed} / ${
                    metrics.provisioningQueue.total_users || metrics.totalWallets
                  }`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics.provisioningQueue.queued > 0
                ? `${metrics.provisioningQueue.queued} queued for generation`
                : '100% deposit addresses provisioned'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Platform Custody</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? '...' : metrics.platformWallets.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Active Hot / Cold operational vaults</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Postgres Engine</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  supabaseConfig.isConfigured ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              <div className="text-sm font-semibold">
                {supabaseConfig.isConfigured ? 'Atomic RPC Active' : 'Hybrid Engine'}
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Double-entry ledger & escrow RPCs</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs Layout */}
      <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">System Balances</TabsTrigger>
          <TabsTrigger value="provisioning">Provisioning Queue</TabsTrigger>
          <TabsTrigger value="custody">Platform Custody Vaults</TabsTrigger>
        </TabsList>

        {/* Tab 1: System Balances */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Aggregated User Balances</CardTitle>
              <CardDescription>
                Consolidated available and locked escrow balances across all platform users.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {(['BTC', 'ETH', 'USDT', 'LTC'] as const).map((asset) => {
                    const bal = metrics.totalBalances[asset] || {
                      available: 0,
                      locked_escrow: 0,
                      locked_withdrawal: 0,
                    };
                    return (
                      <div key={asset} className="flex flex-col p-4 border rounded-xl bg-card">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <CryptoIconBadge name={asset} className="h-6 w-6" />
                            <span className="font-semibold">{asset}</span>
                          </div>
                          <Badge variant="outline">{asset}</Badge>
                        </div>
                        <div className="space-y-1.5 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Available:</span>
                            <span className="font-mono font-medium">
                              {bal.available.toFixed(asset === 'USDT' ? 2 : 6)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">In Escrow:</span>
                            <span className="font-mono font-medium text-amber-500">
                              {bal.locked_escrow.toFixed(asset === 'USDT' ? 2 : 6)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">In Withdrawal:</span>
                            <span className="font-mono font-medium text-blue-500">
                              {bal.locked_withdrawal.toFixed(asset === 'USDT' ? 2 : 6)}
                            </span>
                          </div>
                          <div className="pt-2 border-t flex justify-between font-semibold">
                            <span>Total:</span>
                            <span className="font-mono">
                              {(bal.available + bal.locked_escrow + bal.locked_withdrawal).toFixed(
                                asset === 'USDT' ? 2 : 6
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 2: Provisioning Queue */}
        <TabsContent value="provisioning" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Deposit Address Provisioning Queue</CardTitle>
              <CardDescription>
                Status of unique custodial deposit address allocation per user and chain.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3 mb-6">
                <div className="p-4 border rounded-lg bg-emerald-500/10 border-emerald-500/20">
                  <div className="flex items-center gap-2 text-emerald-500 font-semibold mb-1">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Completed</span>
                  </div>
                  <div className="text-2xl font-bold">{metrics.provisioningQueue.completed}</div>
                  <p className="text-xs text-muted-foreground">Users with assigned deposit sets</p>
                </div>

                <div className="p-4 border rounded-lg bg-amber-500/10 border-amber-500/20">
                  <div className="flex items-center gap-2 text-amber-500 font-semibold mb-1">
                    <Clock className="h-4 w-4" />
                    <span>Queued / Processing</span>
                  </div>
                  <div className="text-2xl font-bold">
                    {metrics.provisioningQueue.queued + metrics.provisioningQueue.processing}
                  </div>
                  <p className="text-xs text-muted-foreground">Pending background derivation</p>
                </div>

                <div className="p-4 border rounded-lg bg-rose-500/10 border-rose-500/20">
                  <div className="flex items-center gap-2 text-rose-500 font-semibold mb-1">
                    <AlertCircle className="h-4 w-4" />
                    <span>Failed / Retrying</span>
                  </div>
                  <div className="text-2xl font-bold">{metrics.provisioningQueue.failed}</div>
                  <p className="text-xs text-muted-foreground">Requires manual intervention</p>
                </div>
              </div>

              <div className="p-4 bg-muted/40 rounded-lg border text-sm space-y-2">
                <div className="font-semibold">Custody Provisioning Architecture</div>
                <p className="text-muted-foreground">
                  Each platform account is provisioned with unique, segregated blockchain deposit addresses for BTC,
                  ETH (ERC20), USDT (ERC20/TRC20), and LTC. Deposits are detected automatically by blockchain listeners
                  and credited via single-transaction Postgres ledger executions.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab 3: Platform Custody Vaults */}
        <TabsContent value="custody" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle>Platform Custody Reference Vaults</CardTitle>
                <CardDescription>
                  Hot and cold operational wallets utilized for liquidity rebalancing and payout execution.
                </CardDescription>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter vaults..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead>Network</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Vault Address</TableHead>
                      <TableHead>Balance</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPlatformWallets.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                          No custody vaults match your filter.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredPlatformWallets.map((pw) => (
                        <TableRow key={pw.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <CryptoIconBadge name={pw.asset_code} className="h-5 w-5" />
                              <span>{pw.asset_code}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{pw.network_code}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={pw.wallet_type === 'hot' ? 'default' : 'outline'} className="capitalize">
                              {pw.wallet_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[200px] truncate" title={pw.public_address}>
                            {pw.public_address}
                          </TableCell>
                          <TableCell className="font-mono font-medium">
                            {pw.current_balance.toLocaleString()} {pw.asset_code}
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/30">
                              {pw.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copyAddress(pw.public_address)}
                              title="Copy address"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
