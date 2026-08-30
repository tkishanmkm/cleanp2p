
"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { User } from "@/lib/types";

const actionSchema = z.object({
  reason: z.string().min(10, "A reason of at least 10 characters is required."),
});

type ActionFormValues = z.infer<typeof actionSchema>;

export type AdminActionType = 'ban' | 'unban' | 'hold' | 'unhold' | 'cancel' | 'paid' | 'release' | 'award_buyer' | 'award_seller';

interface AdminActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null; // User is only relevant for user-specific actions
  action: AdminActionType | null;
  onConfirm: (reason: string) => Promise<void>;
}

export function AdminActionDialog({ open, onOpenChange, user, action, onConfirm }: AdminActionDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const form = useForm<ActionFormValues>({
    resolver: zodResolver(actionSchema),
    defaultValues: {
        reason: ""
    }
  });
  
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
        form.reset();
    }
    onOpenChange(isOpen);
  }

  const onSubmit = async (values: ActionFormValues) => {
    setIsLoading(true);
    await onConfirm(values.reason);
    setIsLoading(false);
    handleOpenChange(false);
  };
  
  if (!action) return null;

  const titleMap: Record<AdminActionType, string> = {
    ban: "Ban User",
    unban: "Unban User",
    hold: "Place Account on Hold",
    unhold: "Remove Account Hold",
    cancel: "Admin: Cancel Trade",
    paid: "Admin: Mark as Paid",
    release: "Admin: Release Funds",
    award_buyer: "Resolve Dispute: Award to Buyer",
    award_seller: "Resolve Dispute: Award to Seller",
  };
  
  const descriptionMap: Record<AdminActionType, string> = {
      ban: `You are about to ban ${user?.userId}. They will not be able to trade.`,
      unban: `You are about to lift the ban for ${user?.userId}.`,
      hold: `You are about to place a hold on ${user?.userId}'s account. They will not be able to trade or transact.`,
      unhold: `You are about to remove the hold on ${user?.userId}'s account.`,
      cancel: 'This will forcibly cancel the trade and attempt to return funds from escrow to the seller.',
      paid: 'This will forcibly mark the trade as paid, as if the buyer did it.',
      release: 'This will forcibly release the escrowed funds to the buyer.',
      award_buyer: 'This will resolve the dispute, awarding the crypto to the buyer and completing the trade.',
      award_seller: 'This will resolve the dispute, awarding the crypto back to the seller and cancelling the trade.'
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titleMap[action]}</DialogTitle>
          <DialogDescription>{descriptionMap[action]}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason for this action</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Provide a clear reason for this administrative action..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Action
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
