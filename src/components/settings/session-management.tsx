"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Smartphone, Monitor, LogOut, CheckCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, orderBy, query } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import type { Session } from '@/lib/types';
import { toDate } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { logoutSessions } from '@/lib/users';

export function SessionManagement() {
  const [currentSessionId, setCurrentSessionId] = useState('');
  const { toast } = useToast();
  const { firestore, user: authUser, auth } = useFirebase();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState<string | 'all' | null>(null);

  useEffect(() => {
    const storedSessionId = sessionStorage.getItem('sessionId');
    if (storedSessionId) {
      setCurrentSessionId(storedSessionId);
    }
  }, []);
  
  const sessionsQuery = useMemoFirebase(() => 
    authUser ? query(collection(firestore, `users/${authUser.uid}/sessions`), orderBy('lastLogin', 'desc')) : null, 
    [authUser, firestore]
  );
  const { data: sessions, isLoading } = useCollection<Session>(sessionsQuery);

  const handleLogout = async (sessionIds: string[] | 'all_other') => {
    if (!firestore || !authUser || !currentSessionId || !auth) {
        toast({
            variant: "destructive",
            title: "Error",
            description: "Could not log out. Please try again.",
        });
        return;
    }

    let idsToLogout: string[] = [];
    let isLoggingOutAll = false;
    if (sessionIds === 'all_other') {
        setIsLoggingOut('all');
        idsToLogout = sessions?.filter(s => s.id !== currentSessionId && s.isActive).map(s => s.id) || [];
        isLoggingOutAll = true;
    } else {
        setIsLoggingOut(sessionIds[0]);
        idsToLogout = sessionIds;
    }

    // Special case: User clicks "log out all" but there are no other sessions.
    // Log out the current device for security.
    if (idsToLogout.length === 0 && isLoggingOutAll) {
      toast({ title: "No Other Active Sessions", description: "Logging out from this device." });
      await signOut(auth);
      router.push('/login');
      setIsLoggingOut(null);
      return;
    }

    // If there are no sessions to log out (for a single logout click), do nothing.
    if (idsToLogout.length === 0) {
      toast({ title: "No Action Needed", description: "That session is already inactive." });
      setIsLoggingOut(null);
      return;
    }

    try {
        await logoutSessions(firestore, authUser.uid, idsToLogout);
        toast({ title: "Success", description: "The selected session(s) have been marked as inactive." });

        // If the user clicked "log out all", also log out the current device and redirect.
        if (isLoggingOutAll) {
            toast({ title: "Securing Account", description: "Logging you out from this device for security." });
            await signOut(auth);
            router.push('/login');
        }

    } catch (error: any) {
        toast({ variant: "destructive", title: "Failed to Logout", description: error.message });
    } finally {
        setIsLoggingOut(null);
    }
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions & Login History</CardTitle>
        <CardDescription>Manage your active sessions and review recent login activity. Logging out a session will prevent it from being used until the next login.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && (
            <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
            </div>
        )}
        {!isLoading && sessions?.map(session => {
            const isMobile = /Mobi|Android/i.test(session.userAgent);
            const isCurrent = session.id === currentSessionId;
            const isLoggingOutThis = isLoggingOut === session.id;

            return (
                 <Alert key={session.id} variant={isCurrent ? "default" : "secondary"} className={isCurrent ? 'border-primary' : ''}>
                    <div className="flex items-center gap-4">
                        {isMobile ? <Smartphone className="h-6 w-6" /> : <Monitor className="h-6 w-6" />}
                        <div className="flex-grow">
                            <AlertTitle className="flex items-center gap-2">
                                {isCurrent ? 'Current Session' : (session.isActive ? 'Active Session' : 'Inactive Session')}
                                {isCurrent && <CheckCircle className="h-4 w-4 text-green-500" />}
                            </AlertTitle>
                            <AlertDescription className="text-xs break-all">
                                {session.userAgent}
                            </AlertDescription>
                            <div className="text-xs text-muted-foreground mt-1">
                                <span>IP: {session.ipAddress}</span> | <span>{toDate(session.lastLogin) ? formatDistanceToNow(toDate(session.lastLogin)!) + ' ago' : 'N/A'}</span>
                            </div>
                        </div>
                        {!isCurrent && session.isActive && (
                            <Button variant="ghost" size="sm" onClick={() => handleLogout([session.id])} disabled={!!isLoggingOut}>
                                {isLoggingOutThis ? <Loader2 className="h-4 w-4 animate-spin"/> : 'Logout'}
                            </Button>
                        )}
                    </div>
                </Alert>
            );
        })}
         {!isLoading && !sessions?.length && (
            <p className="text-sm text-center text-muted-foreground py-4">No session history found.</p>
         )}
      </CardContent>
      <CardFooter className="border-t px-6 py-4">
        <Button variant="outline" onClick={() => handleLogout('all_other')} disabled={!!isLoggingOut}>
            {isLoggingOut === 'all' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <LogOut className="mr-2 h-4 w-4" />
            Log out from all other devices
        </Button>
      </CardFooter>
    </Card>
  );
}
