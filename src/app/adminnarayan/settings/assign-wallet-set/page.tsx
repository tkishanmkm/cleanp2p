'use client';

import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Loader2, AlertTriangle, DatabaseZap } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export default function AssignWalletSetPage() {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  const handleAssignSet = async () => {
    setIsProcessing(true);
    setProgress(0);
    setLogs(['Starting process...']);

    try {
      setLogs((prev) => [...prev, 'Requesting the server-side monotonic wallet-index allocator...']);
      setProgress(35);

      const response = await fetch('/api/admin/wallet-index/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });
      const result = await response.json().catch(() => null);

      if (!response.ok || result?.success !== true) {
        throw new Error(result?.error || 'Wallet index allocation was rejected. No client-side update was attempted.');
      }

      const assignedCount = Number(result.assignedCount);
      const remainingCount = Number(result.remainingCount);
      if (!Number.isSafeInteger(assignedCount) || assignedCount < 0 ||
          !Number.isSafeInteger(remainingCount) || remainingCount < 0) {
        throw new Error('The server returned an invalid allocation summary. Reconciliation is required.');
      }

      setProgress(100);
      setLogs((prev) => [
        ...prev,
        `Allocated ${assignedCount} distinct wallet derivation index(es).`,
        `Last allocated index: ${result.lastWalletIndex ?? 'none'}.`,
        `Profiles still missing an index: ${remainingCount}.`,
      ]);

      if (result.complete === true && remainingCount === 0) {
        toast({
          title: 'Wallet Index Allocation Complete',
          description: assignedCount === 0
            ? 'Every profile already has a wallet derivation index.'
            : `${assignedCount} profile(s) received distinct sequential wallet derivation indexes.`,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Allocation Requires Reconciliation',
          description: `${remainingCount} profile(s) still have no wallet index. Do not provision addresses until the remaining rows are reconciled.`,
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown allocation failure.';
      console.error('Wallet index allocation failed:', error);
      toast({ variant: 'destructive', title: 'Allocation Failed', description: message });
      setLogs((prev) => [...prev, 'ERROR: ' + message]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center">
        <h1 className="text-lg font-semibold md:text-2xl">Wallet Index Allocation</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Allocate Missing Wallet Indexes</CardTitle>
          <CardDescription className="flex items-start gap-2 pt-2">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500" />
            <div>
              This tool assigns each profile without a wallet derivation index a distinct value from the database's
              monotonic allocation sequence. Existing indexes are never overwritten. Allocation is performed by a
              server-authorized database function and is protected by the unique wallet-index constraint.
            </div>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isProcessing && (
            <div className="space-y-4">
              <Progress value={progress} />
              <div className="w-full h-64 bg-muted rounded-md p-4 overflow-y-auto">
                <pre className="text-xs font-mono">
                  {logs.map((log, i) => (
                    <div key={i}>{log}</div>
                  ))}
                </pre>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isProcessing}>
                {isProcessing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <DatabaseZap className="mr-2 h-4 w-4" />
                )}
                Allocate Missing Wallet Indexes
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will allocate a distinct sequential wallet derivation index for each profile that is missing one.
                  Existing indexes will remain unchanged. The action is blocked until the server-side allocator migration
                  is installed and verified.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleAssignSet}>Yes, Start Assignment</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>
    </div>
  );
}
