
"use client";

import { useState, useEffect, useMemo } from "react";
import { useFirebase } from "@/firebase";
import { collection, query, getDocs, orderBy, collectionGroup } from "firebase/firestore";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Check, X, Search, Copy } from "lucide-react";
import type { Withdrawal } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { approveWithdrawal, declineWithdrawal } from "@/lib/admin";
import { supabase } from "@/lib/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn, toDate } from "@/lib/utils";
import { useAdminStatus } from "@/hooks/use-admin-status";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const statusColors: Record<Withdrawal['status'], string> = {
  pending: "border-yellow-500/50 text-yellow-600 bg-yellow-50",
  approved: "border-green-500/50 text-green-600 bg-green-50",
  declined: "border-red-500/50 text-red-600 bg-red-50",
  cancelled: "border-gray-500/50 text-gray-600 bg-gray-50",
};

function WithdrawalsTable({ 
    withdrawals, 
    isLoading,
    onApprove,
    onDecline,
    onRowClick
}: { 
    withdrawals: Withdrawal[] | null; 
    isLoading: boolean;
    onApprove: (withdrawal: Withdrawal) => void;
    onDecline: (withdrawal: Withdrawal) => void;
    onRowClick: (withdrawal: Withdrawal) => void;
}) {
    if (isLoading) {
        return <p className="text-center text-sm text-muted-foreground py-4">Loading...</p>;
    }
    if (!withdrawals || withdrawals.length === 0) {
        return <p className="text-center text-sm text-muted-foreground py-8">No withdrawals found.</p>;
    }

    return (
        <>
            <div className="hidden md:block">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>ID</TableHead>
                            <TableHead>User</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {withdrawals.map((w) => (
                            <TableRow key={w.id} onClick={() => onRowClick(w)} className="cursor-pointer">
                                <TableCell className="font-mono text-xs max-w-[100px] truncate">{w.id}</TableCell>
                                <TableCell className="font-medium">{w.userDisplayName}</TableCell>
                                <TableCell>{w.amount.toFixed(8)} {w.crypto}</TableCell>
                                <TableCell>
                                    <Badge variant="outline" className={cn("capitalize", statusColors[w.status])}>
                                    {w.status}
                                    </Badge>
                                </TableCell>
                                <TableCell>{toDate(w.createdAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) ?? 'N/A'}</TableCell>
                                <TableCell className="text-right">
                                    {w.status === 'pending' && (
                                        <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button aria-haspopup="true" size="icon" variant="ghost" onClick={(e) => e.stopPropagation()}>
                                            <MoreHorizontal className="h-4 w-4" />
                                            <span className="sr-only">Toggle menu</span>
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                            <DropdownMenuItem onClick={(e) => {e.stopPropagation(); onApprove(w)}}>
                                                <Check className="mr-2 h-4 w-4" /> Approve
                                            </DropdownMenuItem>
                                            <DropdownMenuItem className="text-destructive" onClick={(e) => {e.stopPropagation(); onDecline(w)}}>
                                                <X className="mr-2 h-4 w-4" /> Decline
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                        </DropdownMenu>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            <div className="grid gap-4 md:hidden">
                {withdrawals.map((w) => (
                    <Card key={w.id} onClick={() => onRowClick(w)}>
                         <CardHeader>
                            <CardTitle className="text-base">{w.amount.toFixed(4)} {w.crypto}</CardTitle>
                            <CardDescription>{w.userDisplayName}</CardDescription>
                        </CardHeader>
                        <CardContent>
                             <Badge variant="outline" className={cn("capitalize", statusColors[w.status])}>{w.status}</Badge>
                        </CardContent>
                        {w.status === 'pending' && (
                            <CardFooter className="gap-2">
                                <Button size="sm" className="flex-1" onClick={(e) => { e.stopPropagation(); onApprove(w); }}><Check className="mr-2 h-4 w-4" /> Approve</Button>
                                <Button size="sm" variant="destructive" className="flex-1" onClick={(e) => { e.stopPropagation(); onDecline(w); }}><X className="mr-2 h-4 w-4" /> Decline</Button>
                            </CardFooter>
                        )}
                    </Card>
                ))}
            </div>
        </>
    );
}

export default function AdminWithdrawalsPage() {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();

  const [allWithdrawals, setAllWithdrawals] = useState<Withdrawal[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<Withdrawal | null>(null);
  const [isApproveAlertOpen, setIsApproveAlertOpen] = useState(false);
  const [isDeclineAlertOpen, setIsDeclineAlertOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  useEffect(() => {
    if (isAdminLoading) return;
    if (!isAdmin || !firestore) {
      setIsLoading(false);
      return;
    }

    const fetchWithdrawals = async () => {
      setIsLoading(true);
      try {
        const withdrawalsRef = collectionGroup(firestore, "withdrawals");
        const q = query(withdrawalsRef);
        const snapshot = await getDocs(q);
        
        let withdrawalsData = snapshot.docs.map(doc => {
            const data = doc.data() as Omit<Withdrawal, 'id' | 'userId'>;
            const pathParts = doc.ref.path.split('/');
            const userId = pathParts[1]; // Assumes path is users/{userId}/withdrawals/{withdrawalId}
            return { ...data, id: doc.id, userId: userId };
        });

        withdrawalsData.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
        
        setAllWithdrawals(withdrawalsData);

      } catch (error) {
        console.error("Error fetching withdrawals:", error);
        toast({ variant: "destructive", title: "Error", description: "Could not fetch withdrawals." });
      } finally {
        setIsLoading(false);
      }
    };

    fetchWithdrawals();
  }, [isAdmin, isAdminLoading, firestore, toast]);

  const filteredWithdrawals = useMemo(() => {
    if (!allWithdrawals) return null;
    if (!searchTerm.trim()) return allWithdrawals;

    const lowercasedFilter = searchTerm.toLowerCase();
    
    return allWithdrawals.filter(w => {
        return (
            w.userDisplayName.toLowerCase().includes(lowercasedFilter) ||
            w.id.toLowerCase().includes(lowercasedFilter) ||
            w.address.toLowerCase().includes(lowercasedFilter) ||
            w.amount.toString().includes(lowercasedFilter) ||
            (toDate(w.createdAt)?.toLocaleString() ?? '').toLowerCase().includes(lowercasedFilter)
        );
    });
  }, [allWithdrawals, searchTerm]);

  const pendingWithdrawals = useMemo(() => {
      return filteredWithdrawals?.filter(w => w.status === 'pending') || null;
  }, [filteredWithdrawals]);


  const handleApprove = async () => {
    if (!selectedWithdrawal) return;
    try {
      // 1. Fetch Supabase session token if available
      let token = "";
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        token = sessionData.session?.access_token || "";
      } catch (err) {
        console.warn("Could not retrieve Supabase session token:", err);
      }

      // 2. Call admin approval API route
      let apiSucceeded = false;
      if (token) {
        const res = await fetch('/api/admin/withdrawals/approve', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ withdrawalId: selectedWithdrawal.id }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          // If API returns an error response, raise it
          throw new Error(data.error || `Server responded with status ${res.status}`);
        }

        apiSucceeded = true;
      }

      // 3. Keep Firestore admin fallback in sync if firestore and user exist
      if (!apiSucceeded && firestore && user) {
        await approveWithdrawal(firestore, selectedWithdrawal, user.uid);
      }

      toast({
        title: "Withdrawal Approved",
        description: `Withdrawal for ${selectedWithdrawal.userDisplayName} (${selectedWithdrawal.amount} ${selectedWithdrawal.crypto}) has been approved.`,
      });

      // Update UI table row status
      setAllWithdrawals(withdrawals =>
        withdrawals?.map(w => (w.id === selectedWithdrawal.id ? { ...w, status: 'approved' } : w)) || null
      );
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Approval Failed",
        description: e.message || "Failed to approve withdrawal.",
      });
    }
    setIsApproveAlertOpen(false);
    setSelectedWithdrawal(null);
  };
  
  const handleDecline = async () => {
    if (!firestore || !selectedWithdrawal || !user) return;
    try {
      await declineWithdrawal(firestore, selectedWithdrawal, user.uid);
      toast({ title: "Withdrawal Declined", description: `Funds have been returned to user ${selectedWithdrawal.userDisplayName}.` });
      setAllWithdrawals(withdrawals => withdrawals?.map(w => w.id === selectedWithdrawal.id ? {...w, status: 'declined'} : w) || null);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Decline Failed", description: e.message });
    }
    setIsDeclineAlertOpen(false);
    setSelectedWithdrawal(null);
  };

  const openApproveDialog = (withdrawal: Withdrawal) => {
    setSelectedWithdrawal(withdrawal);
    setIsApproveAlertOpen(true);
  }

  const openDeclineDialog = (withdrawal: Withdrawal) => {
    setSelectedWithdrawal(withdrawal);
    setIsDeclineAlertOpen(true);
  }
  
  const handleRowClick = (withdrawal: Withdrawal) => {
    setSelectedWithdrawal(withdrawal);
    setIsDetailsOpen(true);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Withdrawal Requests</h1>
      </div>
      <Card>
        <CardHeader>
           <CardTitle>Manage Withdrawals</CardTitle>
           <CardDescription>Review, approve, or decline user withdrawal requests.</CardDescription>
           <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search by User ID, amount, address, ID, or date..." 
                className="pl-10" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
        </CardHeader>
        <CardContent>
            <Tabs defaultValue="pending">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="pending">Pending</TabsTrigger>
                    <TabsTrigger value="all">All Withdrawals</TabsTrigger>
                </TabsList>
                <TabsContent value="pending" className="mt-4">
                    <WithdrawalsTable 
                        withdrawals={pendingWithdrawals} 
                        isLoading={isLoading || isAdminLoading} 
                        onApprove={openApproveDialog}
                        onDecline={openDeclineDialog}
                        onRowClick={handleRowClick}
                    />
                </TabsContent>
                <TabsContent value="all" className="mt-4">
                     <WithdrawalsTable 
                        withdrawals={filteredWithdrawals} 
                        isLoading={isLoading || isAdminLoading} 
                        onApprove={openApproveDialog}
                        onDecline={openDeclineDialog}
                        onRowClick={handleRowClick}
                    />
                </TabsContent>
            </Tabs>
        </CardContent>
      </Card>
      
      <AlertDialog open={isApproveAlertOpen} onOpenChange={setIsApproveAlertOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Approve Withdrawal?</AlertDialogTitle>
                <AlertDialogDescription>
                    This will mark the withdrawal as complete and debit the locked funds from the user's wallet. This action cannot be undone.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleApprove}>Confirm & Approve</AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
       <AlertDialog open={isDeclineAlertOpen} onOpenChange={setIsDeclineAlertOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Decline Withdrawal?</AlertDialogTitle>
                <AlertDialogDescription>
                    This will cancel the request and return the locked funds to the user's available balance. This action cannot be undone.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDecline} className="bg-destructive hover:bg-destructive/90">Confirm & Decline</AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
       <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Withdrawal Details</DialogTitle>
                <DialogDescription>Full details for the transaction.</DialogDescription>
            </DialogHeader>
            {selectedWithdrawal && (
                <div className="space-y-4 py-4 text-sm">
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Withdrawal ID</span>
                        <div className="flex items-center gap-2">
                           <span className="font-mono text-xs">{selectedWithdrawal.id}</span>
                           <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copyToClipboard(selectedWithdrawal.id!)}><Copy className="h-3 w-3" /></Button>
                        </div>
                    </div>
                     <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">User</span>
                        <span className="font-medium">{selectedWithdrawal.userDisplayName}</span>
                    </div>
                     <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Status</span>
                        <Badge variant="outline" className={cn("capitalize", statusColors[selectedWithdrawal.status])}>{selectedWithdrawal.status}</Badge>
                    </div>
                     <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Amount</span>
                        <span className="font-medium">{selectedWithdrawal.amount.toFixed(8)} {selectedWithdrawal.crypto}</span>
                    </div>
                     <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Chain</span>
                        <span className="font-medium">{selectedWithdrawal.chain}</span>
                    </div>
                     <div className="flex justify-between items-start gap-4">
                        <span className="text-muted-foreground flex-shrink-0">Address</span>
                        <div className="flex items-center gap-2">
                            <span className="font-mono text-xs break-all text-right">{selectedWithdrawal.address}</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copyToClipboard(selectedWithdrawal.address)}><Copy className="h-3 w-3" /></Button>
                        </div>
                    </div>
                     <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Date Requested</span>
                        <span className="font-medium">{toDate(selectedWithdrawal.createdAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                     {selectedWithdrawal.adminId && <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Processed by Admin</span>
                        <span className="font-mono text-xs">{selectedWithdrawal.adminId}</span>
                    </div>}
                </div>
            )}
        </DialogContent>
      </Dialog>
    </>
  );
}
