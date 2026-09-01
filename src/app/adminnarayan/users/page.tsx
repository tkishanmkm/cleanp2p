'use client';

import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { setUserBanStatus, setUserHoldStatus } from '@/lib/admin';
import { Button } from '@/components/ui/button';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { useAuth } from '@/components/providers/auth-provider';
import { useState, useEffect, useMemo } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Search } from 'lucide-react';
import { AdminActionDialog, type AdminActionType } from '@/components/admin/admin-action-dialog';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase/client';

export default function AdminUsersPage() {
  const { user: adminUser } = useAuth();
  const { toast } = useToast();
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();
  const [users, setUsers] = useState<User[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [dialogState, setDialogState] = useState<{
    open: boolean;
    user: User | null;
    action: AdminActionType | null;
  }>({ open: false, user: null, action: null });

  useEffect(() => {
    if (isAdminLoading) return;
    if (!isAdmin) {
      setIsLoading(false);
      return;
    }

    const fetchUsers = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;

        const allUsers: User[] = (data || []).map((u: any) => ({
          id: u.id,
          userId: u.username || u.userId || u.id,
          fullName: u.full_name || u.fullName || u.username || 'User',
          dob: u.dob || '1970-01-01',
          isBanned: u.is_banned ?? u.isBanned ?? (u.status === 'banned'),
          isOnHold: u.is_on_hold ?? u.isOnHold ?? (u.status === 'suspended'),
          tradeVolume: u.trade_volume || u.tradeVolume || 0,
          completedTrades: u.completed_trades || u.completedTrades || 0,
          usernameChanged: u.username_changed ?? u.usernameChanged ?? false,
          createdAt: u.created_at || u.createdAt || new Date().toISOString(),
          feedbackScore: u.feedback_score || u.feedbackScore || 100,
          positiveFeedback: u.positive_feedback || u.positiveFeedback || 0,
          negativeFeedback: u.negative_feedback || u.negativeFeedback || 0,
          avgPaymentTime: u.avg_payment_time || u.avgPaymentTime || 0,
          avgReleaseTime: u.avg_release_time || u.avgReleaseTime || 0,
          photoURL: u.avatar_url || u.photoURL || '',
          preferredCurrency: u.preferred_currency || u.preferredCurrency || 'USD',
          securityQuestion: u.security_question || u.securityQuestion || '',
          securityAnswer: u.security_answer || u.securityAnswer || '',
          isAdminAccount: Boolean(u.is_admin || u.role === 'admin'),
          blockedUsers: u.blocked_users || u.blockedUsers || [],
          oldUserId: u.old_username || u.oldUserId,
        }));

        const regularUsers = allUsers.filter((user) => user.isAdminAccount !== true);
        setUsers(regularUsers);
      } catch (error: any) {
        console.error('Error fetching users:', error);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch users.' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchUsers();
  }, [isAdmin, isAdminLoading, toast]);

  const filteredUsers = useMemo(() => {
    if (!users) return null;
    if (!searchTerm.trim()) return users;
    const lower = searchTerm.toLowerCase();
    return users.filter(
      (u) =>
        u.userId.toLowerCase().includes(lower) ||
        u.fullName.toLowerCase().includes(lower) ||
        u.id.toLowerCase().includes(lower)
    );
  }, [users, searchTerm]);

  const openActionDialog = (user: User, action: AdminActionType) => {
    setDialogState({ open: true, user, action });
  };

  const handleActionConfirm = async (reason: string) => {
    if (!dialogState.user || !dialogState.action || !adminUser) return;

    const { user, action } = dialogState;
    try {
      if (action === 'ban' || action === 'unban') {
        await setUserBanStatus(null, user.id, user.userId, action === 'ban', adminUser.uid, reason);
      } else if (action === 'hold' || action === 'unhold') {
        await setUserHoldStatus(null, user.id, user.userId, action === 'hold', adminUser.uid, reason);
      }
      toast({ title: 'User Updated', description: `${user.userId}'s status has been updated.` });
      setUsers(
        (currentUsers) =>
          currentUsers?.map((u) => {
            if (u.id === user.id) {
              if (action === 'ban') return { ...u, isBanned: true };
              if (action === 'unban') return { ...u, isBanned: false };
              if (action === 'hold') return { ...u, isOnHold: true };
              if (action === 'unhold') return { ...u, isOnHold: false };
            }
            return u;
          }) || null
      );
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };

  return (
    <>
      <AdminActionDialog
        open={dialogState.open}
        onOpenChange={(open) => setDialogState((prev) => ({ ...prev, open }))}
        user={dialogState.user}
        action={dialogState.action}
        onConfirm={handleActionConfirm}
      />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">User Management</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Registered Users</CardTitle>
          <CardDescription>View and manage all user accounts on the platform.</CardDescription>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by User ID, full name, or system ID..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User ID</TableHead>
                  <TableHead>Full Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={4}>Loading users...</TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  filteredUsers?.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        <Button variant="link" asChild className="p-0 h-auto">
                          <Link href={`/adminnarayan/users/${user.userId}`}>
                            <div>{user.userId}</div>
                            {user.oldUserId && (
                              <div className="text-xs text-muted-foreground">(was {user.oldUserId})</div>
                            )}
                          </Link>
                        </Button>
                      </TableCell>
                      <TableCell>{user.fullName}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {user.isBanned && <Badge variant="destructive">Banned</Badge>}
                          {user.isOnHold && (
                            <Badge variant="secondary" className="bg-yellow-500 text-white">
                              On Hold
                            </Badge>
                          )}
                          {!user.isBanned && !user.isOnHold && <Badge className="bg-green-500">Active</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onClick={() => openActionDialog(user, user.isOnHold ? 'unhold' : 'hold')}
                            >
                              {user.isOnHold ? 'Remove Hold' : 'Place on Hold'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className={user.isBanned ? '' : 'text-destructive'}
                              onClick={() => openActionDialog(user, user.isBanned ? 'unban' : 'ban')}
                            >
                              {user.isBanned ? 'Unban' : 'Ban User'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                {!isLoading && !filteredUsers?.length && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center h-24">
                      No users found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="md:hidden grid gap-4">
            {isLoading && <p>Loading users...</p>}
            {!isLoading &&
              filteredUsers?.map((user) => (
                <Card key={user.id}>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle>
                          <Link href={`/adminnarayan/users/${user.userId}`} className="hover:underline">
                            {user.userId}
                          </Link>
                        </CardTitle>
                        <CardDescription>{user.fullName}</CardDescription>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            onClick={() => openActionDialog(user, user.isOnHold ? 'unhold' : 'hold')}
                          >
                            {user.isOnHold ? 'Remove Hold' : 'Place on Hold'}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className={user.isBanned ? '' : 'text-destructive'}
                            onClick={() => openActionDialog(user, user.isBanned ? 'unban' : 'ban')}
                          >
                            {user.isBanned ? 'Unban' : 'Ban User'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardHeader>
                  <CardFooter>
                    <div className="flex gap-2">
                      {user.isBanned && <Badge variant="destructive">Banned</Badge>}
                      {user.isOnHold && (
                        <Badge variant="secondary" className="bg-yellow-500 text-white">
                          On Hold
                        </Badge>
                      )}
                      {!user.isBanned && !user.isOnHold && <Badge className="bg-green-500">Active</Badge>}
                    </div>
                  </CardFooter>
                </Card>
              ))}
            {!isLoading && !filteredUsers?.length && (
              <p className="text-center text-sm text-muted-foreground py-8">No users found.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
