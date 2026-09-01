'use client';

import { useState, useEffect, useMemo } from 'react';
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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Check, X, Copy, Search, Eye } from 'lucide-react';
import type { Deposit } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { approveDeposit, declineDeposit } from '@/lib/admin';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn, toDate } from '@/lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@/components/providers/auth-provider';
import { supabase } from '@/lib/supabase/client';

const statusColors: Record<string, string> = {
  pending: 'border-gray-500/50 text-gray-600 bg-gray-50',
  awaiting_confirmation: 'border-yellow-500/50 text-yellow-600 bg-yellow-50',
  approved: 'border-green-500/50 text-green-600 bg-green-50',
  declined: 'border-red-500/50 text-red-600 bg-red-50',
  expired: 'border-orange-500/50 text-orange-600 bg-orange-50',
};

const depositStatusText: Record<string, string> = {
  pending: 'Pending User Action',
  awaiting_confirmation: 'Waiting for Approval',
  approved: 'Approved',
  declined: 'Cancelled by Admin',
  expired: 'Expired',
};

interface DepositsTableProps {
  status?: Deposit['status'];
  searchTerm: string;
  onRowClick: (deposit: Deposit) => void;
  onApproveClick: (deposit: Deposit) => void;
  onDeclineClick: (deposit: Deposit) => void;
}

function DepositsTable({
  status,
  searchTerm,
  onRowClick,
  onApproveClick,
  onDeclineClick,
}: DepositsTableProps) {
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();
  const { toast } = useToast();

  const [deposits, setDeposits] = useState<Deposit[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isAdminLoading) {
      setIsLoading(true);
      return;
    }

    if (!isAdmin) {
      setIsLoading(false);
      setDeposits([]);
      return;
    }

    const fetchDeposits = async () => {
      setIsLoading(true);
      try {
        let query = supabase.from('deposits').select('*');
        if (status) {
          query = query.eq('status', status);
        }
        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;

        const depositsData: Deposit[] = (data || []).map((doc: any) => ({
          id: doc.id,
          userId: doc.user_id || doc.userId,
          userDisplayName: doc.user_display_name || doc.userDisplayName || 'User',
          crypto: doc.crypto || 'USDT',
          amount: Number(doc.amount || 0),
          finalAmount: doc.final_amount ? Number(doc.final_amount) : undefined,
          chain: doc.chain || 'TRC20',
          walletAddress: doc.wallet_address || doc.walletAddress || '',
          walletIndex: doc.wallet_index ?? doc.walletIndex ?? 1,
          status: doc.status || 'pending',
          createdAt: doc.created_at || doc.createdAt || new Date().toISOString(),
          timerEnd: doc.timer_end || doc.timerEnd || new Date().toISOString(),
          txId: doc.tx_id || doc.txId,
          adminId: doc.admin_id || doc.adminId,
        }));

        setDeposits(depositsData);
      } catch (error) {
        console.error('Failed to fetch deposits:', error);
        toast({
          variant: 'destructive',
          title: 'Error fetching deposits',
          description: (error as Error).message,
        });
        setDeposits([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchDeposits();
  }, [status, isAdmin, isAdminLoading, toast]);

  const filteredDeposits = useMemo(() => {
    if (!deposits) return null;
    if (!searchTerm.trim()) return deposits;

    const lowercasedFilter = searchTerm.toLowerCase();
    return deposits.filter(
      (d) =>
        d.id.toLowerCase().includes(lowercasedFilter) ||
        d.userDisplayName.toLowerCase().includes(lowercasedFilter) ||
        d.txId?.toLowerCase().includes(lowercasedFilter) ||
        d.amount.toString().includes(lowercasedFilter)
    );
  }, [deposits, searchTerm]);

  return (
    <div className="space-y-4">
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Deposit ID</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>TxID</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-4">
                  Loading...
                </TableCell>
              </TableRow>
            )}
            {!isLoading &&
              filteredDeposits?.map((deposit) => (
                <TableRow
                  key={deposit.id}
                  onClick={() => onRowClick(deposit)}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="font-mono text-xs max-w-[100px] truncate">{deposit.id}</TableCell>
                  <TableCell className="font-medium">{deposit.userDisplayName}</TableCell>
                  <TableCell>
                    {deposit.amount} {deposit.crypto}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn('capitalize', statusColors[deposit.status])}>
                      {depositStatusText[deposit.status] || deposit.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs max-w-[120px] truncate">
                    {deposit.txId || 'N/A'}
                  </TableCell>
                  <TableCell>
                    {toDate(deposit.createdAt)?.toLocaleString('default', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" onClick={() => onRowClick(deposit)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      {deposit.status === 'awaiting_confirmation' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => onApproveClick(deposit)}>
                              <Check className="mr-2 h-4 w-4" /> Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => onDeclineClick(deposit)}
                            >
                              <X className="mr-2 h-4 w-4" /> Decline
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && !filteredDeposits?.length && (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                  No deposits found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-4 md:hidden">
        {isLoading && <p className="text-center py-4 text-muted-foreground">Loading...</p>}
        {!isLoading &&
          filteredDeposits?.map((deposit) => (
            <Card key={deposit.id} onClick={() => onRowClick(deposit)}>
              <CardHeader>
                <CardTitle className="text-base">
                  {deposit.amount} {deposit.crypto}
                </CardTitle>
                <CardDescription>{deposit.userDisplayName}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="outline" className={cn('capitalize', statusColors[deposit.status])}>
                    {depositStatusText[deposit.status] || deposit.status}
                  </Badge>
                </div>
              </CardContent>
              {deposit.status === 'awaiting_confirmation' && (
                <CardFooter className="gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      onApproveClick(deposit);
                    }}
                  >
                    <Check className="mr-2 h-4 w-4" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeclineClick(deposit);
                    }}
                  >
                    <X className="mr-2 h-4 w-4" /> Decline
                  </Button>
                </CardFooter>
              )}
            </Card>
          ))}
        {!isLoading && !filteredDeposits?.length && (
          <p className="text-center text-sm text-muted-foreground py-8">No deposits found.</p>
        )}
      </div>
    </div>
  );
}

export default function AdminDepositsPage() {
  const { user: adminUser } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | null>(null);
  const [isApproveAlertOpen, setIsApproveAlertOpen] = useState(false);
  const [isDeclineAlertOpen, setIsDeclineAlertOpen] = useState(false);
  const [editableAmount, setEditableAmount] = useState('');
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const handleApproveClick = (deposit: Deposit) => {
    setSelectedDeposit(deposit);
    setEditableAmount(deposit.amount.toString());
    setIsApproveAlertOpen(true);
  };

  const handleDeclineClick = (deposit: Deposit) => {
    setSelectedDeposit(deposit);
    setIsDeclineAlertOpen(true);
  };

  const handleRowClick = (deposit: Deposit) => {
    setSelectedDeposit(deposit);
    setIsDetailsOpen(true);
  };

  const copyToClipboard = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  };

  const handleApprove = async () => {
    if (!selectedDeposit || !adminUser) return;

    const finalAmount = parseFloat(editableAmount);
    if (isNaN(finalAmount) || finalAmount <= 0) {
      toast({ variant: 'destructive', title: 'Invalid Amount', description: 'Please enter a valid positive number.' });
      return;
    }

    try {
      await approveDeposit(null, selectedDeposit, finalAmount, adminUser.uid);
      toast({
        title: 'Deposit Approved',
        description: `User ${selectedDeposit.userDisplayName}'s balance has been updated.`,
      });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Approval Failed', description: e.message });
    }
    setIsApproveAlertOpen(false);
    setSelectedDeposit(null);
  };

  const handleDecline = async () => {
    if (!selectedDeposit || !adminUser) return;
    try {
      await declineDeposit(null, selectedDeposit, adminUser.uid);
      toast({ title: 'Deposit Declined' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Decline Failed', description: e.message });
    }
    setIsDeclineAlertOpen(false);
    setSelectedDeposit(null);
  };

  const qrCodeValue = selectedDeposit
    ? selectedDeposit.crypto === 'BTC' || selectedDeposit.crypto === 'LTC'
      ? `${selectedDeposit.crypto.toLowerCase()}:${selectedDeposit.walletAddress}?amount=${selectedDeposit.amount}`
      : selectedDeposit.walletAddress
    : '';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Deposit Requests</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Filter & Search</CardTitle>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by Deposit ID, User ID, TxID, or amount..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
      </Card>
      <Tabs defaultValue="awaiting_confirmation" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="awaiting_confirmation">Pending Approval</TabsTrigger>
          <TabsTrigger value="pending">Pending User Action</TabsTrigger>
          <TabsTrigger value="expired">Expired</TabsTrigger>
          <TabsTrigger value="all">All Deposits</TabsTrigger>
        </TabsList>
        <TabsContent value="awaiting_confirmation">
          <Card>
            <CardHeader>
              <CardTitle>Deposits Pending Approval</CardTitle>
              <CardDescription>
                Users have confirmed these transfers. Please verify and approve or decline.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DepositsTable
                status="awaiting_confirmation"
                searchTerm={searchTerm}
                onRowClick={handleRowClick}
                onApproveClick={handleApproveClick}
                onDeclineClick={handleDeclineClick}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="pending">
          <Card>
            <CardHeader>
              <CardTitle>Deposits Pending User Action</CardTitle>
              <CardDescription>
                Users have initiated these deposits but have not yet confirmed the transfer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DepositsTable
                status="pending"
                searchTerm={searchTerm}
                onRowClick={handleRowClick}
                onApproveClick={handleApproveClick}
                onDeclineClick={handleDeclineClick}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="expired">
          <Card>
            <CardHeader>
              <CardTitle>Expired Deposit Requests</CardTitle>
              <CardDescription>These requests were not completed by the user in time.</CardDescription>
            </CardHeader>
            <CardContent>
              <DepositsTable
                status="expired"
                searchTerm={searchTerm}
                onRowClick={handleRowClick}
                onApproveClick={handleApproveClick}
                onDeclineClick={handleDeclineClick}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle>All Deposits</CardTitle>
              <CardDescription>A complete history of all deposit requests on the platform.</CardDescription>
            </CardHeader>
            <CardContent>
              <DepositsTable
                searchTerm={searchTerm}
                onRowClick={handleRowClick}
                onApproveClick={handleApproveClick}
                onDeclineClick={handleDeclineClick}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={isApproveAlertOpen} onOpenChange={setIsApproveAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Deposit?</AlertDialogTitle>
            <div className="space-y-4 text-sm pt-2">
              <p className="text-muted-foreground">
                You are about to approve a deposit for user{' '}
                <strong className="text-foreground">{selectedDeposit?.userDisplayName}</strong>. This will credit their
                wallet. This action cannot be undone.
              </p>
              <div className="p-4 border rounded-md space-y-3 bg-secondary/50 text-foreground">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">User:</span>
                  <span className="font-semibold">{selectedDeposit?.userDisplayName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Requested Amount:</span>
                  <span className="font-semibold">
                    {selectedDeposit?.amount} {selectedDeposit?.crypto}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-2">
                  <span className="text-muted-foreground">TxID:</span>
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="font-mono text-xs bg-muted p-1 rounded max-w-[180px] truncate">
                      {selectedDeposit?.txId || 'N/A'}
                    </span>
                    {selectedDeposit?.txId ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => copyToClipboard(selectedDeposit!.txId!)}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="approved-amount">Approved Amount ({selectedDeposit?.crypto})</Label>
                <Input
                  id="approved-amount"
                  type="number"
                  step="any"
                  value={editableAmount}
                  onChange={(e) => setEditableAmount(e.target.value)}
                  className="bg-background"
                />
                <p className="text-xs text-muted-foreground">
                  You can correct the amount here if the user sent a different amount than requested.
                </p>
              </div>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedDeposit(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApprove}>Confirm & Approve</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={isDeclineAlertOpen} onOpenChange={setIsDeclineAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decline Deposit?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to decline the deposit of{' '}
              <span className="font-bold">
                {selectedDeposit?.amount} {selectedDeposit?.crypto}
              </span>{' '}
              for user <span className="font-bold">{selectedDeposit?.userDisplayName}</span>? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedDeposit(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDecline} className="bg-destructive hover:bg-destructive/90">
              Confirm & Decline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Deposit Details</DialogTitle>
            <DialogDescription>Full details for the deposit request.</DialogDescription>
          </DialogHeader>
          {selectedDeposit && (
            <div className="space-y-4 py-4 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Deposit ID</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{selectedDeposit.id}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => copyToClipboard(selectedDeposit.id)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">User</span>
                <span className="font-medium">{selectedDeposit.userDisplayName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Status</span>
                <Badge variant="outline" className={cn('capitalize', statusColors[selectedDeposit.status])}>
                  {depositStatusText[selectedDeposit.status] || selectedDeposit.status}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Requested Amount</span>
                <span className="font-medium">
                  {selectedDeposit.amount} {selectedDeposit.crypto}
                </span>
              </div>
              {selectedDeposit.finalAmount ? (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Approved Amount</span>
                  <span className="font-medium">
                    {selectedDeposit.finalAmount} {selectedDeposit.crypto}
                  </span>
                </div>
              ) : null}
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Chain</span>
                <span className="font-medium">{selectedDeposit.chain}</span>
              </div>
              <div className="flex justify-between items-start gap-4">
                <span className="text-muted-foreground flex-shrink-0">TxID</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs break-all text-right">{selectedDeposit.txId || 'N/A'}</span>
                  {selectedDeposit.txId ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => copyToClipboard(selectedDeposit.txId!)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Date Requested</span>
                <span className="font-medium">{toDate(selectedDeposit.createdAt)?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Expires</span>
                <span className="font-medium">{toDate(selectedDeposit.timerEnd)?.toLocaleString()}</span>
              </div>
              {selectedDeposit.adminId ? (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Processed by Admin</span>
                  <span className="font-mono text-xs">{selectedDeposit.adminId}</span>
                </div>
              ) : null}

              <div className="flex flex-col items-center gap-2 pt-4">
                <div className="p-2 bg-white rounded-lg">
                  <QRCodeSVG value={qrCodeValue} size={128} />
                </div>
                <div className="flex items-center gap-1 p-1 bg-muted rounded-md w-full">
                  <p className="font-mono text-xs break-all text-center flex-grow">
                    {selectedDeposit.walletAddress}
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => copyToClipboard(selectedDeposit.walletAddress)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
