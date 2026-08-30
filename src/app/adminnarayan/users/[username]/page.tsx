
'use client';

import { useParams } from 'next/navigation';
import Image from 'next/image';
import { useState, useEffect } from 'react';
import { useFirebase, useDoc, useMemoFirebase, useCollection } from '@/firebase';
import { collection, query, where, getDocs, doc, orderBy, documentId, limit } from 'firebase/firestore';
import type { User, P2PAd, Trade, UserWallet, Deposit, Withdrawal, AdminLog, Session } from '@/lib/types';
import { format, formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AdjustBalanceDialog } from '@/components/admin/adjust-balance-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DefaultAvatar } from '@/components/icons';
import { AdCard } from '@/components/p2p/ad-card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SlidersHorizontal, Calendar, CheckCircle, Clock, DollarSign, FileText, User as UserIcon, UserCheck, Wallet, ArrowLeftRight, ThumbsUp, ThumbsDown, Globe, Smartphone, Monitor, KeyRound } from 'lucide-react';
import { cn, toDate } from '@/lib/utils';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useToast } from '@/hooks/use-toast';
import { adminUnblockUser } from '@/lib/admin';
import { countries } from '@/lib/countries';
import { FlagIcon } from '@/components/ui/flag-icon';

function DetailItem({ icon, label, value }: { icon: React.ReactNode, label: string, value: string | number | undefined }) {
    if (!value && value !== 0) return null;
    return (
        <div className="flex items-start gap-4">
            <div className="text-muted-foreground mt-1">{icon}</div>
            <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="font-medium">{value}</p>
            </div>
        </div>
    );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
                {children}
            </CardContent>
        </Card>
    );
}

export default function AdminUserDetailPage() {
  const params = useParams();
  const { firestore } = useFirebase();
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();
  const [isAdjustBalanceOpen, setIsAdjustBalanceOpen] = useState(false);
  const username = Array.isArray(params.username) ? params.username[0] : params.username;
  const { toast } = useToast();

  const userQuery = useMemoFirebase(
    () => (firestore && username ? query(collection(firestore, 'users'), where('userId', '==', username), limit(1)) : null),
    [firestore, username]
  );
  const { data: users, isLoading: isUserLoading } = useCollection<User>(userQuery);
  const user = users?.[0];
  const userId = user?.id;
  
  const [ads, setAds] = useState<P2PAd[] | null>(null);
  const [deposits, setDeposits] = useState<Deposit[] | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[] | null>(null);
  const [allTrades, setAllTrades] = useState<Trade[] | null>(null);
  const [adminLogs, setAdminLogs] = useState<AdminLog[] | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<User[] | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  
  const [areAdsLoading, setAreAdsLoading] = useState(true);
  const [areDepositsLoading, setAreDepositsLoading] = useState(true);
  const [areWithdrawalsLoading, setAreWithdrawalsLoading] = useState(true);
  const [isLoadingTrades, setIsLoadingTrades] = useState(true);
  const [areLogsLoading, setAreLogsLoading] = useState(true);
  const [areBlockedUsersLoading, setAreBlockedUsersLoading] = useState(true);
  const [areSessionsLoading, setAreSessionsLoading] = useState(true);


  useEffect(() => {
    if (!isAdmin || !firestore || !userId) {
      if (!isAdminLoading) {
          setAreAdsLoading(false);
          setAreDepositsLoading(false);
          setAreWithdrawalsLoading(false);
          setIsLoadingTrades(false);
          setAreLogsLoading(false);
          setAreSessionsLoading(false);
      }
      return;
    };

    const fetchAllData = async () => {
      try {
        const adsQuery = query(collection(firestore, "p2p_ads"), where("userId", "==", userId));
        const adsSnapshot = await getDocs(adsQuery);
        setAds(adsSnapshot.docs.map(d => ({...d.data(), id: d.id } as P2PAd)));
      } catch (e) { setAds([]); }
      finally { setAreAdsLoading(false); }

      try {
        const depositsQuery = query(collection(firestore, "deposits"), where("userId", "==", userId));
        const depositsSnapshot = await getDocs(depositsQuery);
        const depositsData = depositsSnapshot.docs.map(d => ({...d.data(), id: d.id } as Deposit));
        depositsData.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
        setDeposits(depositsData);
      } catch (e) { setDeposits([]); }
      finally { setAreDepositsLoading(false); }
      
      try {
        const withdrawalsQuery = query(collection(firestore, `users/${userId}/withdrawals`), orderBy('createdAt', 'desc'));
        const withdrawalsSnapshot = await getDocs(withdrawalsQuery);
        setWithdrawals(withdrawalsSnapshot.docs.map(d => ({...d.data(), id: d.id } as Withdrawal)));
      } catch (e) { setWithdrawals([]); }
      finally { setAreWithdrawalsLoading(false); }

      try {
        const tradesAsBuyerQuery = query(collection(firestore, 'trades'), where('buyerId', '==', userId));
        const tradesAsSellerQuery = query(collection(firestore, 'trades'), where('sellerId', '==', userId));
        const [buyerSnapshot, sellerSnapshot] = await Promise.all([getDocs(tradesAsBuyerQuery), getDocs(tradesAsSellerQuery)]);
        const combined = [...buyerSnapshot.docs.map(d => ({...d.data(), id: d.id} as Trade)), ...sellerSnapshot.docs.map(d => ({...d.data(), id: d.id} as Trade))];
        const uniqueTrades = Array.from(new Map(combined.map(trade => [trade.id, trade])).values());
        uniqueTrades.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
        setAllTrades(uniqueTrades);
      } catch (e) { setAllTrades([]); }
      finally { setIsLoadingTrades(false); }

      try {
        const logsQuery = query(collection(firestore, 'admin_logs'), where('targetId', '==', userId));
        const logsSnapshot = await getDocs(logsQuery);
        const logsData = logsSnapshot.docs.map(d => ({...d.data(), id: d.id } as AdminLog));
        logsData.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
        setAdminLogs(logsData);
      } catch(e) { setAdminLogs([]); }
      finally { setAreLogsLoading(false); }
      
      try {
        const sessionsQuery = query(collection(firestore, `users/${userId}/sessions`), orderBy('lastLogin', 'desc'), limit(10));
        const sessionsSnapshot = await getDocs(sessionsQuery);
        setSessions(sessionsSnapshot.docs.map(d => ({...d.data(), id: d.id } as Session)));
      } catch(e) { setSessions([]); }
      finally { setAreSessionsLoading(false); }
    };

    fetchAllData();
  }, [firestore, userId, isAdmin, isAdminLoading]);
  
  useEffect(() => {
    if (!user || !firestore) {
      setAreBlockedUsersLoading(false);
      return;
    }

    const fetchBlockedUsers = async () => {
      if (user.blockedUsers && user.blockedUsers.length > 0) {
        setAreBlockedUsersLoading(true);
        try {
          const blockedUsersQuery = query(collection(firestore, 'users'), where(documentId(), 'in', user.blockedUsers));
          const blockedUsersSnapshot = await getDocs(blockedUsersQuery);
          setBlockedUsers(blockedUsersSnapshot.docs.map(d => ({ ...doc.data(), id: d.id } as User)));
        } catch (e) { setBlockedUsers([]); }
        finally { setAreBlockedUsersLoading(false); }
      } else {
        setBlockedUsers([]);
        setAreBlockedUsersLoading(false);
      }
    };
    fetchBlockedUsers();
  }, [user, firestore]);

  const handleAdminUnblock = async (targetUserId: string, targetUsername: string) => {
    if (!firestore || !user) return;
    if (!confirm(`Are you sure you want to force ${user.userId} to unblock ${targetUsername}?`)) return;
    try {
      await adminUnblockUser(firestore, user.id, targetUserId);
      toast({ title: 'User Unblocked' });
      setBlockedUsers(current => current?.filter(u => u.id !== targetUserId) || null);
    } catch (e: any) { toast({ variant: 'destructive', title: 'Error' }); }
  };

  if (isUserLoading || isAdminLoading) return <div className="space-y-6"><Skeleton className="h-48 w-full" /><Skeleton className="h-96 w-full" /></div>;
  if (!user) return <Card><CardHeader><CardTitle>User Not Found</CardTitle></CardHeader></Card>;
  
  const getCountryName = (code?: string) => code ? countries.find(c => c.code === code)?.name : 'N/A';

  return (
    <>
        <AdjustBalanceDialog open={isAdjustBalanceOpen} onOpenChange={setIsAdjustBalanceOpen} userId={user.id} userDisplayName={user.userId} />
        <div className="flex items-center justify-between mb-6">
             <h1 className="text-lg font-semibold md:text-2xl">User Details</h1>
             <Button onClick={() => setIsAdjustBalanceOpen(true)}><SlidersHorizontal className="mr-2 h-4 w-4" />Manage Wallet Balance</Button>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-1 space-y-6">
                <Card>
                    <CardContent className="pt-6 flex flex-col items-center text-center">
                        <Avatar className="h-32 w-32 mb-4 border-4 border-secondary shadow-lg">
                            {user.photoURL ? <Image src={user.photoURL} alt={user.userId} width={128} height={128} className="object-cover"/> : <AvatarFallback className="bg-transparent"><DefaultAvatar /></AvatarFallback>}
                        </Avatar>
                        <h2 className="text-2xl font-bold">{user.userId}</h2>
                        <p className="text-muted-foreground">{user.fullName}</p>
                        <div className="flex gap-2 mt-4">
                            {user.isBanned && <Badge variant="destructive">Banned</Badge>}
                            {user.isOnHold && <Badge variant="secondary" className="bg-yellow-500 text-white">On Hold</Badge>}
                            {!user.isBanned && !user.isOnHold && <Badge className="bg-green-500">Active</Badge>}
                        </div>
                    </CardContent>
                </Card>
                <SectionCard title="User Information">
                     <div className="space-y-4">
                        <DetailItem icon={<UserIcon size={20} />} label="Full Name" value={user.fullName} />
                        <DetailItem icon={<Calendar size={20} />} label="Date of Birth" value={toDate(user.dob)?.toLocaleDateString()} />
                        <DetailItem icon={<Globe size={20} />} label="Origin Country" value={getCountryName(user.country)} />
                        <DetailItem icon={<Clock size={20} />} label="Member Since" value={toDate(user.createdAt)?.toLocaleDateString()} />
                        <DetailItem icon={<Wallet size={20} />} label="Wallet Set" value={user.walletIndex} />
                     </div>
                </SectionCard>
            </div>
            <div className="lg:col-span-2 space-y-6">
                <SectionCard title="Wallets">
                    <Table>
                        <TableHeader><TableRow><TableHead>Asset</TableHead><TableHead>Available</TableHead><TableHead>Locked</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {user.wallets && Object.entries(user.wallets).map(([crypto, data]) => (
                                <TableRow key={crypto}><TableCell>{crypto}</TableCell><TableCell>{data?.balance?.toFixed(8)}</TableCell><TableCell>{data?.lockedBalance?.toFixed(8)}</TableCell></TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </SectionCard>
                <SectionCard title="Trade History">
                     <Table>
                         <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Role</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
                         <TableBody>
                             {allTrades?.map(t => (
                                 <TableRow key={t.id}>
                                     <TableCell className="font-mono text-xs">{t.tradeId}</TableCell>
                                     <TableCell><Badge variant={t.buyerId === userId ? 'default' : 'secondary'}>{t.buyerId === userId ? 'Buyer' : 'Seller'}</Badge></TableCell>
                                     <TableCell>{t.amount.toFixed(6)} {t.crypto}</TableCell>
                                     <TableCell><Badge variant="outline" className="capitalize">{t.status}</Badge></TableCell>
                                     <TableCell><Button asChild variant="outline" size="sm"><Link href={`/trade/${t.id}`}><ArrowLeftRight className="mr-2 h-3 w-3" />View</Link></Button></TableCell>
                                 </TableRow>
                             ))}
                         </TableBody>
                     </Table>
                </SectionCard>
            </div>
        </div>
    </>
  );
}
