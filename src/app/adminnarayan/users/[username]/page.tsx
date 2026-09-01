'use client';

import { useParams } from 'next/navigation';
import Image from 'next/image';
import { useState, useEffect } from 'react';
import type { User, P2PAd, Trade, Deposit, Withdrawal, AdminLog, Session } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { AdjustBalanceDialog } from '@/components/admin/adjust-balance-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DefaultAvatar } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SlidersHorizontal, Calendar, Clock, User as UserIcon, Wallet, ArrowLeftRight, Globe } from 'lucide-react';
import { toDate } from '@/lib/utils';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useToast } from '@/hooks/use-toast';
import { adminUnblockUser } from '@/lib/admin';
import { countries } from '@/lib/countries';
import { supabase } from '@/lib/supabase/client';

function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number | undefined }) {
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
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function AdminUserDetailPage() {
  const params = useParams();
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();
  const [isAdjustBalanceOpen, setIsAdjustBalanceOpen] = useState(false);
  const username = Array.isArray(params.username) ? params.username[0] : params.username;
  const { toast } = useToast();

  const [user, setUser] = useState<User | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);

  const [allTrades, setAllTrades] = useState<Trade[] | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<User[] | null>(null);

  useEffect(() => {
    if (!username) return;

    const fetchUserProfile = async () => {
      setIsUserLoading(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .ilike('username', username)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          const u: User = {
            id: data.id,
            userId: data.username || data.id,
            fullName: data.full_name || data.username || 'User',
            dob: data.dob || '1970-01-01',
            isBanned: data.is_banned ?? (data.status === 'banned'),
            isOnHold: data.is_on_hold ?? (data.status === 'suspended'),
            tradeVolume: data.trade_volume || 0,
            completedTrades: data.completed_trades || 0,
            usernameChanged: data.username_changed ?? false,
            createdAt: data.created_at || new Date().toISOString(),
            feedbackScore: data.feedback_score || 100,
            positiveFeedback: data.positive_feedback || 0,
            negativeFeedback: data.negative_feedback || 0,
            avgPaymentTime: data.avg_payment_time || 0,
            avgReleaseTime: data.avg_release_time || 0,
            photoURL: data.avatar_url || '',
            preferredCurrency: data.preferred_currency || 'USD',
            country: data.country,
            walletIndex: data.wallet_index,
            securityQuestion: data.security_question || '',
            securityAnswer: data.security_answer || '',
            isAdminAccount: Boolean(data.is_admin || data.role === 'admin'),
            blockedUsers: data.blocked_users || [],
            wallets: {
              BTC: { balance: Number(data.btc_balance || 0), lockedBalance: 0 },
              ETH: { balance: Number(data.eth_balance || 0), lockedBalance: 0 },
              USDT: { balance: Number(data.usdt_balance || 0), lockedBalance: 0 },
              LTC: { balance: Number(data.ltc_balance || 0), lockedBalance: 0 },
            },
          };
          setUser(u);
        } else {
          setUser(null);
        }
      } catch (err) {
        console.error('Error fetching user:', err);
      } finally {
        setIsUserLoading(false);
      }
    };

    fetchUserProfile();
  }, [username]);

  const userId = user?.id;

  useEffect(() => {
    if (!isAdmin || !userId) return;

    const fetchAllData = async () => {
      try {
        const { data: tradesData } = await supabase
          .from('trades')
          .select('*')
          .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
          .order('created_at', { ascending: false });

        if (tradesData) {
          const mappedTrades: Trade[] = tradesData.map((t: any) => ({
            id: t.id,
            tradeId: t.trade_id || t.id,
            buyerId: t.buyer_id,
            sellerId: t.seller_id,
            adId: t.ad_id,
            fiatAmount: Number(t.fiat_amount || 0),
            fiatCurrency: t.fiat_currency || 'USD',
            crypto: t.crypto || 'USDT',
            amount: Number(t.amount || 0),
            price: Number(t.price || 0),
            status: t.status || 'created',
            createdAt: t.created_at || new Date().toISOString(),
            paymentMethod: t.payment_method || 'Bank Transfer',
            buyerUsername: t.buyer_username || 'Buyer',
            sellerUsername: t.seller_username || 'Seller',
          }));
          setAllTrades(mappedTrades);
        }
      } catch (e) {
        setAllTrades([]);
      }
    };

    fetchAllData();
  }, [userId, isAdmin]);

  if (isUserLoading || isAdminLoading)
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  if (!user)
    return (
      <Card>
        <CardHeader>
          <CardTitle>User Not Found</CardTitle>
        </CardHeader>
      </Card>
    );

  const getCountryName = (code?: string) => (code ? countries.find((c) => c.code === code)?.name : 'N/A');

  return (
    <>
      <AdjustBalanceDialog
        open={isAdjustBalanceOpen}
        onOpenChange={setIsAdjustBalanceOpen}
        userId={user.id}
        userDisplayName={user.userId}
      />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold md:text-2xl">User Details</h1>
        <Button onClick={() => setIsAdjustBalanceOpen(true)}>
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Manage Wallet Balance
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardContent className="pt-6 flex flex-col items-center text-center">
              <Avatar className="h-32 w-32 mb-4 border-4 border-secondary shadow-lg">
                {user.photoURL ? (
                  <Image src={user.photoURL} alt={user.userId} width={128} height={128} className="object-cover" />
                ) : (
                  <AvatarFallback className="bg-transparent">
                    <DefaultAvatar />
                  </AvatarFallback>
                )}
              </Avatar>
              <h2 className="text-2xl font-bold">{user.userId}</h2>
              <p className="text-muted-foreground">{user.fullName}</p>
              <div className="flex gap-2 mt-4">
                {user.isBanned && <Badge variant="destructive">Banned</Badge>}
                {user.isOnHold && (
                  <Badge variant="secondary" className="bg-yellow-500 text-white">
                    On Hold
                  </Badge>
                )}
                {!user.isBanned && !user.isOnHold && <Badge className="bg-green-500">Active</Badge>}
              </div>
            </CardContent>
          </Card>
          <SectionCard title="User Information">
            <div className="space-y-4">
              <DetailItem icon={<UserIcon size={20} />} label="Full Name" value={user.fullName} />
              <DetailItem
                icon={<Calendar size={20} />}
                label="Date of Birth"
                value={toDate(user.dob)?.toLocaleDateString()}
              />
              <DetailItem icon={<Globe size={20} />} label="Origin Country" value={getCountryName(user.country)} />
              <DetailItem
                icon={<Clock size={20} />}
                label="Member Since"
                value={toDate(user.createdAt)?.toLocaleDateString()}
              />
              <DetailItem icon={<Wallet size={20} />} label="Wallet Set" value={user.walletIndex} />
            </div>
          </SectionCard>
        </div>
        <div className="lg:col-span-2 space-y-6">
          <SectionCard title="Wallets">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Locked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.wallets &&
                  Object.entries(user.wallets).map(([crypto, data]) => (
                    <TableRow key={crypto}>
                      <TableCell>{crypto}</TableCell>
                      <TableCell>{data?.balance?.toFixed(8)}</TableCell>
                      <TableCell>{data?.lockedBalance?.toFixed(8)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </SectionCard>
          <SectionCard title="Trade History">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allTrades?.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.tradeId}</TableCell>
                    <TableCell>
                      <Badge variant={t.buyerId === userId ? 'default' : 'secondary'}>
                        {t.buyerId === userId ? 'Buyer' : 'Seller'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {t.amount.toFixed(6)} {t.crypto}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/trade/${t.id}`}>
                          <ArrowLeftRight className="mr-2 h-3 w-3" />
                          View
                        </Link>
                      </Button>
                    </TableCell>
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
