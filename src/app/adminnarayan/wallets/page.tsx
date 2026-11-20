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
import { checkSupabaseConfig } from '@/lib/supabase/client';
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
  Shield,
  ArrowDownToLine,
  ArrowUpFromLine,
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
      BTC: { available: 0, reserved: 0, locked_escrow: 0, locked_withdrawal: 0 },
      ETH: { available: 0, reserved: 0, locked_escrow: 0, locked_withdrawal: 0 },
      LTC: { available: 0, reserved: 0, locked_escrow: 0, locked_withdrawal: 0 },
      USDT: { available: 0, reserved: 0, locked_escrow: 0, locked_withdrawal: 0 },
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

  const fetchMetrics = async (): Promise<boolean> => {
    try {
      const { data, error } = await getAdminWalletOverview();
      if (error || !data) {
        throw error || new Error('Platform wallet metrics are unavailable.');
      }

      const defaults = {
        BTC: { available: 0, reserved: 0, locked_escrow: 0, locked_withdrawal: 0 },
        ETH: { available: 0, reserved: 0, locked_escrow: 0, locked_withdrawal: 0 },
        LTC: { available: 0, reserved: 0, locked_escrow: 0, locked_withdrawal: 0 },
        USDT: { available: 0, reserved: 0, locked_escrow: 0, locked_withdrawal: 0 },
        TRX: { available: 0, reserved: 0, locked_escrow: 0, locked_withdrawal: 0 },
      };

      setMetrics({
        ...data,
        totalBalances: { ...defaults, ...data.totalBalances },
      });
      return true;
    } catch (error) {
      console.error('Error fetching authoritative admin wallet metrics:', error);
      toast({
        variant: 'destructive',
        title: 'Wallet metrics unavailable',
        description: error instanceof Error ? error.message : 'The platform wallet report could not be verified.',
      });
      return false;
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
    const refreshed = await fetchMetrics();
    if (refreshed) {
      toast({ title: 'Refreshed', description: 'Authoritative wallet and custody-balance records updated.' });
    }
  };

  const filteredPlatformWallets = metrics.platformWallets.filter((wallet) => {
    const search = searchQuery.trim().toLowerCase();
    return !search ||
      wallet.currency.toLowerCase().includes(search) ||
      wallet.type.toLowerCase().includes(search) ||
      wallet.id.toLowerCase().includes(search);
  });

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
            <CardTitle className="text-sm font-medium">Deposit Address Records</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">
              {loading ? '...' : (metrics.totalDepositAddresses || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {`${metrics.totalDepositAddresses || 0} deposit-address records currently stored`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Custody Balance Records</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{loading ? '...' : metrics.platformWallets.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Actual platform custody balance records</p>
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
                {supabaseConfig.isConfigured ? 'Supabase Configured' : 'Supabase Not Configured'}
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
          <TabsTrigger value="deposits-withdrawals">Total Deposits & Withdrawals</TabsTrigger>
          <TabsTrigger value="provisioning">Provisioning Queue</TabsTrigger>
          <TabsTrigger value="custody">Platform Custody Vaults</TabsTrigger>
        </TabsList>

        {/* Tab 1: System Balances */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Aggregated System & User Balances</CardTitle>
              <CardDescription>
                Consolidated available user funds, locked escrow balances, and platform custody across all cryptocurrencies.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  {(['BTC', 'ETH', 'USDT', 'LTC', 'TRX'] as const).map((asset) => {
                    const bal = (metrics.totalBalances as any)?.[asset] || {
                      available: 0,
                      reserved: 0,
                      locked_escrow: 0,
                      locked_withdrawal: 0,
                    };
                    const isUsdtOrTrx = asset === 'USDT' || asset === 'TRX';
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
                            <span className="text-muted-foreground text-xs">Available:</span>
                            <span className="font-mono font-medium text-xs">
                              {Number(bal.available || 0).toFixed(isUsdtOrTrx ? 2 : 6)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground text-xs">Reserved:</span>
                            <span className="font-mono font-medium text-amber-500 text-xs">
                              {Number(bal.reserved || 0).toFixed(isUsdtOrTrx ? 2 : 6)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground text-xs">In Escrow:</span>
                            <span className="font-mono font-medium text-amber-500 text-xs">
                              {Number(bal.locked_escrow || 0).toFixed(isUsdtOrTrx ? 2 : 6)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground text-xs">In Withdrawal:</span>
                            <span className="font-mono font-medium text-blue-500 text-xs">
                              {Number(bal.locked_withdrawal || 0).toFixed(isUsdtOrTrx ? 2 : 6)}
                            </span>
                          </div>
                          <div className="pt-2 border-t flex justify-between font-semibold">
                            <span className="text-xs">Total User:</span>
                            <span className="font-mono text-xs text-emerald-400">
                              {(Number(bal.available || 0) + Number(bal.reserved || 0) + Number(bal.locked_escrow || 0) + Number(bal.locked_withdrawal || 0)).toFixed(
                                isUsdtOrTrx ? 2 : 6
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

        {/* Tab: Total Deposits & Withdrawals */}
        <TabsContent value="deposits-withdrawals" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Total Deposits Card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2 text-emerald-400">
                      <ArrowDownToLine className="w-5 h-5" />
                      Total System Deposits
                    </CardTitle>
                    <CardDescription>
                      Cumulative confirmed deposit counts and volumes
                    </CardDescription>
                  </div>
                  <Badge className="bg-emerald-950 text-emerald-400 border border-emerald-800">
                    {(metrics as any).totalDeposits?.totalCount || 0} Transactions
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {(['BTC', 'ETH', 'USDT', 'LTC', 'TRX'] as const).map((crypto) => {
                    const cData = (metrics as any).totalDeposits?.byCurrency?.[crypto] || { count: 0, volume: 0 };
                    return (
                      <div key={crypto} className="py-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <CryptoIconBadge name={crypto} className="h-5 w-5" />
                          <div>
                            <p className="font-semibold text-sm">{crypto}</p>
                            <p className="text-[11px] text-muted-foreground">{cData.count} deposits recorded</p>
                          </div>
                        </div>
                        <div className="text-right font-mono">
                          <p className="font-bold text-emerald-400 text-sm">
                            +{Number(cData.volume || 0).toFixed(crypto === 'USDT' || crypto === 'TRX' ? 2 : 6)} {crypto}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Total Withdrawals Card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2 text-purple-400">
                      <ArrowUpFromLine className="w-5 h-5" />
                      Total System Withdrawals
                    </CardTitle>
                    <CardDescription>
                      Cumulative processed payout counts and volumes
                    </CardDescription>
                  </div>
                  <Badge className="bg-purple-950 text-purple-400 border border-purple-800">
                    {(metrics as any).totalWithdrawals?.totalCount || 0} Transactions
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border">
                  {(['BTC', 'ETH', 'USDT', 'LTC', 'TRX'] as const).map((crypto) => {
                    const wData = (metrics as any).totalWithdrawals?.byCurrency?.[crypto] || { count: 0, volume: 0 };
                    return (
                      <div key={crypto} className="py-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <CryptoIconBadge name={crypto} className="h-5 w-5" />
                          <div>
                            <p className="font-semibold text-sm">{crypto}</p>
                            <p className="text-[11px] text-muted-foreground">{wData.count} withdrawals processed</p>
                          </div>
                        </div>
                        <div className="text-right font-mono">
                          <p className="font-bold text-purple-400 text-sm">
                            -{Number(wData.volume || 0).toFixed(crypto === 'USDT' || crypto === 'TRX' ? 2 : 6)} {crypto}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 2: Provisioning Queue */}
        <TabsContent value="provisioning" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Deposit Address Records</CardTitle>
              <CardDescription>
                Count of deposit-address records currently stored in the production database. Queue state is not inferred when no queue table is configured.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3 mb-6">
                <div className="p-4 border rounded-lg bg-emerald-500/10 border-emerald-500/20">
                  <div className="flex items-center gap-2 text-emerald-500 font-semibold mb-1">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Address Records</span>
                  </div>
                  <div className="text-2xl font-bold">{metrics.provisioningQueue.completed}</div>
                  <p className="text-xs text-muted-foreground">Address rows stored; a user may have multiple networks</p>
                </div>

                <div className="p-4 border rounded-lg bg-amber-500/10 border-amber-500/20">
                  <div className="flex items-center gap-2 text-amber-500 font-semibold mb-1">
                    <Clock className="h-4 w-4" />
                    <span>Queued / Processing</span>
                  </div>
                  <div className="text-2xl font-bold">
                    {metrics.provisioningQueue.queued + metrics.provisioningQueue.processing}
                  </div>
                  <p className="text-xs text-muted-foreground">Queue state is not available from the deployed schema</p>
                </div>

                <div className="p-4 border rounded-lg bg-rose-500/10 border-rose-500/20">
                  <div className="flex items-center gap-2 text-rose-500 font-semibold mb-1">
                    <AlertCircle className="h-4 w-4" />
                    <span>Failed / Retrying</span>
                  </div>
                  <div className="text-2xl font-bold">{metrics.provisioningQueue.failed}</div>
                  <p className="text-xs text-muted-foreground">No queue failure state is exposed by the deployed schema</p>
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
                <CardTitle>Platform Custody Balance Records</CardTitle>
                <CardDescription>
                  Only currency balance snapshots stored in admin_main_wallets are listed here. The deployed schema does not store wallet addresses, network roles or custody providers in this table.
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
                      <TableHead className="text-right">Recorded Balance</TableHead>
                      <TableHead>Record Type</TableHead>
                      <TableHead>Last Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPlatformWallets.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                          {metrics.custodyAvailable
                            ? 'No custody balance records match your filter.'
                            : 'No platform custody balance records are configured in the database.'}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredPlatformWallets.map((pw) => (
                        <TableRow key={pw.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <CryptoIconBadge name={pw.currency} className="h-5 w-5" />
                              <span>{pw.currency}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {Number(pw.balance || 0).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{pw.type}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {pw.updated_at ? new Date(pw.updated_at).toLocaleString() : 'Not recorded'}
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
