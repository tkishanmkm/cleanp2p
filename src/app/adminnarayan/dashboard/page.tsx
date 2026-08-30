"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Users, ArrowLeftRight, ShieldAlert, DollarSign, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { useFirebase } from "@/firebase";
import { collection, collectionGroup, query, where, getDocs } from "firebase/firestore";
import { useAdminStatus } from "@/hooks/use-admin-status";
import { useState, useEffect } from "react";

/**
 * Main Admin Dashboard
 * This page serves as the entry point for administrators.
 * Route: /adminnarayan/dashboard
 */
export default function AdminDashboardPage() {
    const { firestore } = useFirebase();
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
        if (!isAdmin || !firestore) {
            setIsLoading(false);
            return;
        }

        const fetchStats = async () => {
            setIsLoading(true);
            try {
                const usersQuery = query(collection(firestore, 'users'));
                const tradesQuery = query(collection(firestore, 'trades'));
                const disputesQuery = query(collectionGroup(firestore, 'disputes'));
                const depositsQuery = query(collection(firestore, 'deposits'));
                const withdrawalsQuery = query(collectionGroup(firestore, 'withdrawals'));

                const [
                    usersSnapshot,
                    tradesSnapshot,
                    disputesSnapshot,
                    depositsSnapshot,
                    withdrawalsSnapshot
                ] = await Promise.all([
                    getDocs(usersQuery),
                    getDocs(tradesQuery),
                    getDocs(disputesQuery),
                    getDocs(depositsQuery),
                    getDocs(withdrawalsQuery)
                ]);

                const allUsers = usersSnapshot.docs.map(doc => doc.data());
                const regularUsersCount = allUsers.filter(user => user.isAdminAccount !== true).length;

                const activeTradesCount = tradesSnapshot.docs.filter(doc => {
                    const status = doc.data().status;
                    return status === 'active' || status === 'paid';
                }).length;

                const openDisputesCount = disputesSnapshot.docs.filter(doc => doc.data().status === 'open').length;

                const pendingDepositsCount = depositsSnapshot.docs.filter(doc => doc.data().status === 'awaiting_confirmation').length;
                
                const pendingWithdrawalsCount = withdrawalsSnapshot.docs.filter(doc => doc.data().status === 'pending').length;

                setStats({
                    users: regularUsersCount,
                    activeTrades: activeTradesCount,
                    openDisputes: openDisputesCount,
                    pendingDeposits: pendingDepositsCount,
                    pendingWithdrawals: pendingWithdrawalsCount,
                });

            } catch (error) {
                console.error("Failed to fetch admin dashboard stats:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchStats();
    }, [isAdmin, isAdminLoading, firestore]);

    const statCards = [
        { title: "Total Users", value: isLoading ? "..." : stats.users, icon: <Users className="h-4 w-4 text-muted-foreground" /> },
        { title: "Active Trades", value: isLoading ? "..." : stats.activeTrades, icon: <ArrowLeftRight className="h-4 w-4 text-muted-foreground" /> },
        { title: "Open Disputes", value: isLoading ? "..." : stats.openDisputes, icon: <ShieldAlert className="h-4 w-4 text-muted-foreground" /> },
        { title: "24h Volume", value: "$...", icon: <DollarSign className="h-4 w-4 text-muted-foreground" />, description: "Calculation not implemented" },
        { title: "Pending Deposits", value: isLoading ? "..." : stats.pendingDeposits, icon: <ArrowDownToLine className="h-4 w-4 text-muted-foreground" /> },
        { title: "Pending Withdrawals", value: isLoading ? "..." : stats.pendingWithdrawals, icon: <ArrowUpFromLine className="h-4 w-4 text-muted-foreground" /> },
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
            <p className="text-muted-foreground text-center py-8">Activity log coming soon...</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
