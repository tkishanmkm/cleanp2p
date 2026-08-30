
"use client";

import { useState, useMemo, useEffect } from 'react';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, documentId, getDocs, limit } from 'firebase/firestore';
import type { User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { blockUser, unblockUser } from '@/lib/users';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DefaultAvatar } from '@/components/icons';
import { Loader2, UserX, XCircle } from 'lucide-react';
import { Skeleton } from '../ui/skeleton';
import { BLOCK_LIMIT } from '@/lib/constants';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from '../ui/scroll-area';


export function BlockedUsersManagement({ user: currentUserData }: { user: User }) {
  const { firestore, user: authUser } = useFirebase();
  const { toast } = useToast();
  const [usernameToBlock, setUsernameToBlock] = useState('');
  const [isBlocking, setIsBlocking] = useState(false);

  // New state for search
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [debounceTimeout, setDebounceTimeout] = useState<NodeJS.Timeout | null>(null);

  const blockedUserIds = useMemo(() => currentUserData?.blockedUsers || [], [currentUserData]);
  
  const blockedUsersQuery = useMemoFirebase(() => 
    (firestore && blockedUserIds.length > 0) 
      ? query(collection(firestore, 'users'), where(documentId(), 'in', blockedUserIds))
      : null
  , [firestore, blockedUserIds]);

  const { data: blockedUsers, isLoading: areBlockedUsersLoading } = useCollection<User>(blockedUsersQuery);

  // New useEffect for debounced search
  useEffect(() => {
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    if (usernameToBlock && usernameToBlock.length >= 2) {
      setIsSearching(true);
      const timeout = setTimeout(async () => {
        if (!firestore || !authUser) return;
        const usersRef = collection(firestore, 'users');
        const q = query(
          usersRef,
          where('userId', '>=', usernameToBlock),
          where('userId', '<=', usernameToBlock + '\uf8ff'),
          limit(5)
        );
        const snapshot = await getDocs(q);
        const blockedIds = currentUserData?.blockedUsers || [];
        const users = snapshot.docs
          .map(doc => ({id: doc.id, ...doc.data()} as User))
          .filter(u => u.id !== authUser.uid && !u.isAdminAccount && !blockedIds.includes(u.id));
        
        setSearchResults(users);
        setIsSearching(false);
      }, 500);
      setDebounceTimeout(timeout as any);
    } else {
      setSearchResults([]);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usernameToBlock, firestore, authUser, currentUserData]);


  const handleBlockUser = async () => {
    if (!firestore || !authUser || !usernameToBlock) return;
    if (usernameToBlock === currentUserData?.userId) {
        toast({ variant: 'destructive', title: 'Error', description: "You cannot block yourself." });
        return;
    }
    if (blockedUserIds.length >= BLOCK_LIMIT) {
      toast({ variant: 'destructive', title: 'Block Limit Reached', description: `You can only block up to ${BLOCK_LIMIT} users.` });
      return;
    }
    setIsBlocking(true);
    try {
      await blockUser(firestore, authUser.uid, usernameToBlock);
      toast({ title: 'User Blocked', description: `${usernameToBlock} has been added to your block list.` });
      setUsernameToBlock('');
      setSearchResults([]);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsBlocking(false);
    }
  };

  const handleUnblockUser = async (targetUserId: string) => {
    if (!firestore || !authUser) return;
    try {
      await unblockUser(firestore, authUser.uid, targetUserId);
      toast({ title: 'User Unblocked' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };
  
  const isLoading = areBlockedUsersLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Blocked Users</CardTitle>
        <CardDescription>Manage users you have blocked. They will not be able to trade with you, and you will not see their ads.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-2">Block a User</h3>
           <div className="flex gap-2">
            <Input
              placeholder="Enter user ID to block"
              value={usernameToBlock}
              onChange={(e) => {
                  setUsernameToBlock(e.target.value);
                  if (e.target.value.length < 2) setSearchResults([]);
              }}
              autoComplete="off"
            />
            <Button onClick={handleBlockUser} disabled={isBlocking || !usernameToBlock}>
              {isBlocking ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
            </Button>
          </div>
          {searchResults.length > 0 && (
            <div className="border rounded-md max-h-48 overflow-y-auto mt-2">
              {isSearching ? <div className="p-2 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/> Searching...</div> : 
              searchResults.map(user => (
                <div 
                  key={user.id} 
                  className="p-2 flex items-center gap-2 cursor-pointer hover:bg-muted"
                  onClick={() => {
                    setUsernameToBlock(user.userId);
                    setSearchResults([]);
                  }}
                >
                  <Avatar className="h-8 w-8">
                    {user.photoURL ? <AvatarImage src={user.photoURL} /> : <AvatarFallback>{user.userId.slice(0,2)}</AvatarFallback>}
                  </Avatar>
                  <span>{user.userId}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">You have blocked {blockedUserIds.length} / {BLOCK_LIMIT} users.</p>
        </div>
        <div>
          <h3 className="text-sm font-medium mb-2">Currently Blocked</h3>
          <div className="space-y-2 rounded-md border p-2 min-h-[80px]">
            {isLoading && <Skeleton className="h-12 w-full" />}
            {!isLoading && blockedUsers && blockedUsers.length > 0 ? (
              blockedUsers.slice(0, 3).map((blockedUser) => (
                <div key={blockedUser.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      {blockedUser.photoURL ? <AvatarImage src={blockedUser.photoURL} alt={blockedUser.userId} /> : <AvatarFallback><DefaultAvatar /></AvatarFallback>}
                    </Avatar>
                    <span className="font-medium">{blockedUser.userId}</span>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleUnblockUser(blockedUser.id)}>
                    <XCircle className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-center text-sm text-muted-foreground py-4">You haven't blocked any users.</p>
            )}
             {blockedUsers && blockedUsers.length > 3 && (
                <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="secondary" className="w-full mt-2">View all {blockedUsers.length} blocked users</Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>All Blocked Users</DialogTitle>
                            <DialogDescription>
                                Unblock users to interact with them again.
                            </DialogDescription>
                        </DialogHeader>
                        <ScrollArea className="h-72 w-full rounded-md border">
                            <div className="p-2 space-y-1">
                                {blockedUsers.map(bu => (
                                    <div key={bu.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
                                        <div className="flex items-center gap-3">
                                            <Avatar className="h-8 w-8">
                                                {bu.photoURL ? <AvatarImage src={bu.photoURL} alt={bu.userId} /> : <AvatarFallback><DefaultAvatar /></AvatarFallback>}
                                            </Avatar>
                                            <span className="font-medium">{bu.userId}</span>
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => handleUnblockUser(bu.id)}>Unblock</Button>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </DialogContent>
                </Dialog>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
