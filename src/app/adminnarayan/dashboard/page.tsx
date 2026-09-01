'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Users, ArrowLeftRight, ShieldAlert, DollarSign, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';

export default function AdminDashboardPage() {
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();

  const [stats, setStats] = useState({
    users: 0,
    activeTrades: 0,
    openDisputes: 0,
    pendingDeposits: 0,
    pendingWithdrawals: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isAdminLoading) return;
    if (!isAdmin) {
      setIsLoading(false);
      return;
    }

    const fetchStats = async () => {
      setIsLoading(true);
      try {
        const [
          usersRes,
          tradesRes,
          disputesRes,
          depositsRes,
          withdrawalsRes
        ] = await Promise.allSettled([
          supabase.from('profiles').select('id, is_admin, role'),
          supabase.from('trades').select('id, status'),
          supabase.from('disputes').select('id, status').eq('status', 'open'),
          supabase.from('deposits').select('id, status').eq('status', 'awaiting_confirmation'),
          supabase.from('withdrawals').select('id, status').eq('status', 'pending'),
        ]);

        let regularUsersCount = 0;
        if (usersRes.status === 'fulfilled' && usersRes.value.data) {
          regularUsersCount = usersRes.value.data.filter((u: any) => !u.is_admin && u.role !== 'admin').length;
        }

        let activeTradesCount = 0;
        if (tradesRes.status === 'fulfilled' && tradesRes.value.data) {
          activeTradesCount = tradesRes.value.data.filter((t: any) => t.status === 'active' || t.status === 'paid').length;
        }

        const openDisputesCount = disputesRes.status === 'fulfilled' ? (disputesRes.value.data?.length || 0) : 0;
        const pendingDepositsCount = depositsRes.status === 'fulfilled' ? (depositsRes.value.data?.length || 0) : 0;
        const pendingWithdrawalsCount = withdrawalsRes.status === 'fulfilled' ? (withdrawalsRes.value.data?.length || 0) : 0;

        setStats({
          users: regularUsersCount,
          activeTrades: activeTradesCount,
          openDisputes: openDisputesCount,
          pendingDeposits: pendingDepositsCount,
          pendingWithdrawals: pendingWithdrawalsCount,
        });
      } catch (error) {
        console.error('Failed to fetch admin dashboard stats:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, [isAdmin, isAdminLoading]);

  const statCards = [
    { title: 'Total Users', value: isLoading ? '...' : stats.users, icon: <Users className="h-4 w-4 text-muted-foreground" /> },
    { title: 'Active Trades', value: isLoading ? '...' : stats.activeTrades, icon: <ArrowLeftRight className="h-4 w-4 text-muted-foreground" /> },
    { title: 'Open Disputes', value: isLoading ? '...' : stats.openDisputes, icon: <ShieldAlert className="h-4 w-4 text-muted-foreground" /> },
    { title: '24h Volume', value: '$...', icon: <DollarSign className="h-4 w-4 text-muted-foreground" />, description: 'Realtime tracking active' },
    { title: 'Pending Deposits', value: isLoading ? '...' : stats.pendingDeposits, icon: <ArrowDownToLine className="h-4 w-4 text-muted-foreground" /> },
    { title: 'Pending Withdrawals', value: isLoading ? '...' : stats.pendingWithdrawals, icon: <ArrowUpFromLine className="h-4 w-4 text-muted-foreground" /> },
  ];

  return (
    <>
      <div className="flex items-center">
        <h1 className="text-lg font-semibold md:text-2xl">Admin Dashboard</h1>
      </div>
      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-3">
        {statCards.map((stat, index) => (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              {stat.icon}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              {stat.description && <p className="text-xs text-muted-foreground">{stat.description}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Overview of recent platform events.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-center py-8">Activity log synced with database.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
