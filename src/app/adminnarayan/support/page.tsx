
"use client";

import { useFirebase } from "@/firebase";
import { collection, query, orderBy, getDocs } from "firebase/firestore";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Loader2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SupportTicket } from "@/lib/types";
import { updateSupportTicketStatus } from "@/lib/admin";
import { useToast } from "@/hooks/use-toast";
import { toDate } from "@/lib/utils";
import { useAdminStatus } from "@/hooks/use-admin-status";
import { useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const replySchema = z.object({
  note: z.string().min(10, "Reply must be at least 10 characters long."),
});
type ReplyFormValues = z.infer<typeof replySchema>;


export default function AdminSupportPage() {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isReplyOpen, setIsReplyOpen] = useState(false);

  const replyForm = useForm<ReplyFormValues>({
    resolver: zodResolver(replySchema),
  });

  useEffect(() => {
    if (isAdminLoading) return;
    if (!isAdmin || !firestore) {
      setIsLoading(false);
      return;
    }

    const fetchTickets = async () => {
      setIsLoading(true);
      try {
        const ticketsRef = collection(firestore, "support_tickets");
        const q = query(ticketsRef, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        setTickets(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as SupportTicket)));
      } catch (error) {
        console.error("Error fetching support tickets:", error);
        toast({ variant: "destructive", title: "Error", description: "Could not fetch support tickets." });
      } finally {
        setIsLoading(false);
      }
    };

    fetchTickets();
  }, [isAdmin, isAdminLoading, firestore, toast]);

  const handleStatusChange = async (ticketId: string, status: SupportTicket['status']) => {
    if (!firestore) return;
    try {
        await updateSupportTicketStatus(firestore, ticketId, status);
        toast({ title: 'Ticket Updated', description: `Status set to ${status}` });
        setTickets(currentTickets => currentTickets?.map(t => t.id === ticketId ? {...t, status} : t) || null);
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Update Failed', description: e.message });
    }
  };
  
  const handleOpenReplyDialog = (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    setIsReplyOpen(true);
  };
  
  const handleReplySubmit = async (values: ReplyFormValues) => {
    if (!firestore || !selectedTicket) return;
    try {
      await updateSupportTicketStatus(firestore, selectedTicket.id, 'Closed', values.note);
      toast({ title: 'Ticket Closed', description: `Reply sent and ticket closed.` });
      setTickets(currentTickets => currentTickets?.map(t => t.id === selectedTicket.id ? {...t, status: 'Closed', resolutionNote: values.note } : t) || null);
      setIsReplyOpen(false);
      replyForm.reset();
    } catch (e: any) {
        toast({ variant: 'destructive', title: 'Reply Failed', description: e.message });
    }
  };
  
  const handleViewDetails = (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    setIsDetailsOpen(true);
  };

  return (
    <>
      <div className="flex items-center">
        <h1 className="text-lg font-semibold md:text-2xl">Support Requests</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Manage Support Tickets</CardTitle>
          <CardDescription>
            View and respond to user-submitted support requests.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="hidden md:block">
            <Table>
                <TableHeader>
                <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted At</TableHead>
                    <TableHead>
                    <span className="sr-only">Actions</span>
                    </TableHead>
                </TableRow>
                </TableHeader>
                <TableBody>
                {isLoading && <TableRow><TableCell colSpan={5} className="text-center">Loading tickets...</TableCell></TableRow>}
                {!isLoading && tickets && tickets.length > 0 ? tickets.map((ticket) => (
                    <TableRow key={ticket.id} onClick={() => handleViewDetails(ticket)} className="cursor-pointer">
                    <TableCell className="font-medium">{ticket.email}</TableCell>
                    <TableCell className="font-medium">{ticket.userId || 'N/A'}</TableCell>
                    <TableCell>
                        <Badge variant={
                            ticket.status === 'Open' ? 'destructive' : 
                            ticket.status === 'In Progress' ? 'default' : 
                            'outline'
                        }>
                        {ticket.status}
                        </Badge>
                    </TableCell>
                    <TableCell>{toDate(ticket.createdAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) ?? 'N/A'}</TableCell>
                    <TableCell>
                        <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button aria-haspopup="true" size="icon" variant="ghost" onClick={(e) => e.stopPropagation()}>
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Toggle menu</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onClick={(e) => {e.stopPropagation(); handleViewDetails(ticket)}}>View Details</DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => {e.stopPropagation(); handleStatusChange(ticket.id, 'In Progress')}}>Mark as In Progress</DropdownMenuItem>
                            <DropdownMenuItem onClick={(e) => {e.stopPropagation(); handleOpenReplyDialog(ticket)}}>Reply & Close</DropdownMenuItem>
                        </DropdownMenuContent>
                        </DropdownMenu>
                    </TableCell>
                    </TableRow>
                )) : (
                    <TableRow>
                        <TableCell colSpan={5} className="text-center h-24">
                            No support tickets found.
                        </TableCell>
                    </TableRow>
                )}
                </TableBody>
            </Table>
          </div>
           <div className="grid gap-4 md:hidden">
              {isLoading && <p className="text-center text-sm text-muted-foreground py-4">Loading tickets...</p>}
              {!isLoading && tickets?.map((ticket) => (
                  <Card key={ticket.id} onClick={() => handleViewDetails(ticket)}>
                       <CardHeader>
                            <div className="flex justify-between items-start">
                                <CardTitle className="text-base">{ticket.email}</CardTitle>
                                 <Badge variant={ticket.status === 'Open' ? 'destructive' : ticket.status === 'In Progress' ? 'default' : 'outline'}>
                                    {ticket.status}
                                </Badge>
                            </div>
                            <CardDescription>{toDate(ticket.createdAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) ?? 'N/A'}</CardDescription>
                      </CardHeader>
                      <CardContent>
                          <p className="text-sm text-muted-foreground line-clamp-3">{ticket.message}</p>
                      </CardContent>
                  </Card>
              ))}
              {!isLoading && !tickets?.length && <p className="text-center text-sm text-muted-foreground py-8">No tickets found.</p>}
          </div>
        </CardContent>
      </Card>
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Support Ticket Details</DialogTitle>
                 {selectedTicket && <DialogDescription>From: {selectedTicket.email} | User: {selectedTicket.userId || 'N/A'} | Submitted: {toDate(selectedTicket.createdAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' })}</DialogDescription>}
            </DialogHeader>
            {selectedTicket && (
                <div className="space-y-4 py-4">
                    <h4 className="font-medium">Message:</h4>
                    <p className="text-sm p-4 bg-muted rounded-md text-muted-foreground whitespace-pre-wrap">{selectedTicket.message}</p>
                     {selectedTicket.resolutionNote && (
                        <div>
                            <h4 className="font-medium">Admin Reply:</h4>
                            <p className="text-sm p-4 bg-green-100 dark:bg-green-900/30 rounded-md whitespace-pre-wrap">{selectedTicket.resolutionNote}</p>
                        </div>
                    )}
                </div>
            )}
        </DialogContent>
      </Dialog>
      <Dialog open={isReplyOpen} onOpenChange={setIsReplyOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Reply & Close Ticket</DialogTitle>
                <DialogDescription>Your reply will be sent to the user and the ticket will be marked as closed.</DialogDescription>
            </DialogHeader>
             <Form {...replyForm}>
                <form onSubmit={replyForm.handleSubmit(handleReplySubmit)} className="space-y-4">
                  <FormField
                    control={replyForm.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Your Reply</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Explain the resolution to the user..." {...field} className="min-h-[120px]"/>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" disabled={replyForm.formState.isSubmitting} className="w-full">
                    {replyForm.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Send Reply and Close
                  </Button>
                </form>
              </Form>
        </DialogContent>
      </Dialog>
    </>
  )
}
