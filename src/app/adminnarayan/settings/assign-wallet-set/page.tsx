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
import { supabase } from '@/lib/supabase/client';

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
      const { data: users, error } = await supabase.from('profiles').select('id, wallet_index');

      if (error) throw error;

      const usersWithoutIndex = (users || []).filter(
        (u: any) => u.wallet_index === undefined || u.wallet_index === null
      );

      if (usersWithoutIndex.length === 0) {
        setLogs((prev) => [...prev, 'All users already have a wallet index. Nothing to do.']);
        setIsProcessing(false);
        return;
      }

      setLogs((prev) => [...prev, `Found ${usersWithoutIndex.length} users to update.`]);

      for (let i = 0; i < usersWithoutIndex.length; i++) {
        const user = usersWithoutIndex[i];
        await supabase.from('profiles').update({ wallet_index: 1 }).eq('id', user.id);

        if ((i + 1) % 10 === 0 || i === usersWithoutIndex.length - 1) {
          setLogs((prev) => [...prev, `Updated ${i + 1}/${usersWithoutIndex.length} users.`]);
          setProgress(((i + 1) / usersWithoutIndex.length) * 100);
        }
      }

      toast({
        title: 'Success',
        description: `Assignment complete. ${usersWithoutIndex.length} users have been assigned to wallet set 1.`,
      });
      setLogs((prev) => [...prev, '---', `Assignment complete. Updated ${usersWithoutIndex.length} users.`]);
    } catch (error: any) {
      console.error('Wallet set assignment failed:', error);
      toast({ variant: 'destructive', title: 'Assignment Failed', description: error.message });
      setLogs((prev) => [...prev, 'ERROR: ' + error.message]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex items-center">
        <h1 className="text-lg font-semibold md:text-2xl">Assign Wallet Sets</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Assign Set 1 to Users</CardTitle>
          <CardDescription className="flex items-start gap-2 pt-2">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-500" />
            <div>
              This tool finds all users who do not have a `wallet_index` and assigns them to Set 1. This is useful for
              migrating existing users to the rotating deposit address system. This operation is safe to run multiple
              times.
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
                Assign Set 1 to Missing Users
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will scan all users and assign `wallet_index: 1` to those who don't have one.
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
