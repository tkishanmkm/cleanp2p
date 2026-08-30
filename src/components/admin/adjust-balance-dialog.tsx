
"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useFirebase } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { CryptoCurrency } from "@/lib/types";
import { SUPPORTED_CRYPTOS } from "@/lib/constants";
import { adjustUserWalletBalance } from "@/lib/admin";

const adjustBalanceSchema = z.object({
  crypto: z.string().min(1, "Please select a cryptocurrency."),
  action: z.enum(["add", "subtract"], { required_error: "Please select an action." }),
  amount: z.coerce.number().positive("Amount must be a positive number."),
  reason: z.string().min(10, "A reason is required (min 10 characters).").max(100, "Reason cannot exceed 100 characters."),
});

type AdjustBalanceFormValues = z.infer<typeof adjustBalanceSchema>;

interface AdjustBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userDisplayName: string;
}

export function AdjustBalanceDialog({ open, onOpenChange, userId, userDisplayName }: AdjustBalanceDialogProps) {
  const { firestore, user: adminUser } = useFirebase();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<AdjustBalanceFormValues>({
    resolver: zodResolver(adjustBalanceSchema),
  });

  async function onSubmit(values: AdjustBalanceFormValues) {
    if (!firestore || !adminUser) return;
    setIsLoading(true);

    try {
      await adjustUserWalletBalance(
        firestore,
        adminUser.uid,
        userId,
        userDisplayName,
        values.crypto as CryptoCurrency,
        values.action as 'add' | 'subtract',
        values.amount,
        values.reason
      );
      toast({
        title: "Balance Adjusted",
        description: `Successfully adjusted ${userDisplayName}'s ${values.crypto} balance.`,
      });
      onOpenChange(false);
      form.reset();
    } catch (error: any) {
      console.error("Balance adjustment failed:", error);
      toast({ variant: "destructive", title: "Adjustment Failed", description: error.message });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen) form.reset();
        onOpenChange(isOpen);
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust Wallet Balance for {userDisplayName}</DialogTitle>
          <DialogDescription>
            Manually add or subtract from a user's available balance. This action will be logged.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="crypto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cryptocurrency</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select asset" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {SUPPORTED_CRYPTOS.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
             <FormField
              control={form.control}
              name="action"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Action</FormLabel>
                  <FormControl>
                    <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-4">
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl><RadioGroupItem value="add" /></FormControl>
                        <FormLabel className="font-normal">Add Balance</FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-x-3 space-y-0">
                        <FormControl><RadioGroupItem value="subtract" /></FormControl>
                        <FormLabel className="font-normal">Subtract Balance</FormLabel>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl><Input type="number" step="any" placeholder="0.00000000" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason for Adjustment</FormLabel>
                  <FormControl><Textarea placeholder="e.g., Manual correction for trade T-12345XYZ" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Adjustment
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
