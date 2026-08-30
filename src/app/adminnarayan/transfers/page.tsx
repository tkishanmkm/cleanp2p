
"use client";

import { useFirebase } from "@/firebase";
import { collection, query, orderBy, getDocs } from "firebase/firestore";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
import type { CoinTransfer } from "@/lib/types";
import { toDate } from "@/lib/utils";
import { useAdminStatus } from "@/hooks/use-admin-status";
import { useState, useEffect, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Copy } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export default function AdminTransfersPage() {
  const { firestore } = useFirebase();
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();
  const [transfers, setTransfers] = useState<CoinTransfer[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();

  const [selectedTransfer, setSelectedTransfer] = useState<CoinTransfer | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  useEffect(() => {
    if (isAdminLoading) return;
    if (!isAdmin || !firestore) {
      setIsLoading(false);
      return;
    }

    const fetchTransfers = async () => {
      setIsLoading(true);
      try {
        const transfersRef = collection(firestore, "transfers");
        const q = query(transfersRef, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        setTransfers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as CoinTransfer)));
      } catch (error) {
        console.error("Error fetching transfers:", error);
        toast({ variant: "destructive", title: "Error", description: "Could not fetch transfers." });
      } finally {
        setIsLoading(false);
      }
    };

    fetchTransfers();
  }, [isAdmin, isAdminLoading, firestore, toast]);

  const filteredTransfers = useMemo(() => {
    if (!transfers) return null;
    if (!searchTerm.trim()) return transfers;
    const lower = searchTerm.toLowerCase();
    return transfers.filter(t => 
        t.publicId.toLowerCase().includes(lower) ||
        t.senderUsername.toLowerCase().includes(lower) ||
        t.recipientUsername.toLowerCase().includes(lower) ||
        t.crypto.toLowerCase().includes(lower) ||
        t.amount.toString().includes(lower)
    );
  }, [transfers, searchTerm]);
  
  const handleRowClick = (transfer: CoinTransfer) => {
    setSelectedTransfer(transfer);
    setIsDetailsOpen(true);
  };
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">User-to-User Transfers</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All Transfers</CardTitle>
          <CardDescription>
            View a log of all direct coin transfers between users.
          </CardDescription>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search by ID, sender, recipient, asset..." 
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
                    <TableHead>Transfer ID</TableHead>
                    <TableHead>Sender</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Date</TableHead>
                </TableRow>
                </TableHeader>
                <TableBody>
                {isLoading && (
                    <TableRow>
                    <TableCell colSpan={5} className="text-center">
                        Loading transfers...
                    </TableCell>
                    </TableRow>
                )}
                {!isLoading && filteredTransfers?.map((transfer) => (
                    <TableRow key={transfer.id} onClick={() => handleRowClick(transfer)} className="cursor-pointer">
                    <TableCell className="font-mono text-xs">{transfer.publicId}</TableCell>
                    <TableCell>
                        <Link href={`/adminnarayan/users/${transfer.senderId}`} className="hover:underline font-medium" onClick={(e) => e.stopPropagation()}>
                            {transfer.senderUsername}
                        </Link>
                    </TableCell>
                    <TableCell>
                        <Link href={`/adminnarayan/users/${transfer.recipientId}`} className="hover:underline font-medium" onClick={(e) => e.stopPropagation()}>
                            {transfer.recipientUsername}
                        </Link>
                    </TableCell>
                    <TableCell className="font-medium">{transfer.amount.toFixed(8)} {transfer.crypto}</TableCell>
                    <TableCell>{toDate(transfer.createdAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
                    </TableRow>
                ))}
                {!isLoading && !filteredTransfers?.length && (
                    <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                        No transfers found.
                    </TableCell>
                    </TableRow>
                )}
                </TableBody>
            </Table>
          </div>
          <div className="grid gap-4 md:hidden">
              {isLoading && <p className="text-center text-sm text-muted-foreground py-4">Loading transfers...</p>}
              {!isLoading && filteredTransfers?.map((transfer) => (
                  <Card key={transfer.id} onClick={() => handleRowClick(transfer)}>
                       <CardHeader>
                            <CardTitle className="text-base font-mono">{transfer.publicId}</CardTitle>
                            <CardDescription>{toDate(transfer.createdAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' })}</CardDescription>
                       </CardHeader>
                        <CardContent className="text-sm space-y-2">
                           <div className="flex justify-between">
                            <span className="text-muted-foreground">From</span>
                            <span className="font-medium">{transfer.senderUsername}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">To</span>
                            <span className="font-medium">{transfer.recipientUsername}</span>
                          </div>
                           <div className="flex justify-between">
                            <span className="text-muted-foreground">Amount</span>
                            <Badge variant="outline">{transfer.amount.toFixed(8)} {transfer.crypto}</Badge>
                          </div>
                       </CardContent>
                  </Card>
              ))}
              {!isLoading && !filteredTransfers?.length && <p className="text-center text-sm text-muted-foreground py-8">No transfers found.</p>}
          </div>
        </CardContent>
      </Card>
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Transfer Details</DialogTitle>
                <DialogDescription>Public ID: {selectedTransfer?.publicId}</DialogDescription>
            </DialogHeader>
            {selectedTransfer && (
                 <div className="space-y-4 py-4 text-sm">
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">System ID</span><div className="flex items-center gap-2"><span className="font-mono text-xs">{selectedTransfer.id}</span><Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => copyToClipboard(selectedTransfer.id!)}><Copy className="h-3 w-3" /></Button></div></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Sender</span><span className="font-medium">{selectedTransfer.senderUsername}</span></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Recipient</span><span className="font-medium">{selectedTransfer.recipientUsername}</span></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Amount</span><Badge variant="outline">{selectedTransfer.amount.toFixed(8)} {selectedTransfer.crypto}</Badge></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Date</span><span className="font-medium">{toDate(selectedTransfer.createdAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
                </div>
            )}
        </DialogContent>
      </Dialog>
    </>
  );
}
