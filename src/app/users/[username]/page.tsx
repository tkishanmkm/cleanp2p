

'use client';

import { useParams } from 'next/navigation';
import Image from 'next/image';
import { useFirebase, useCollection, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, where, limit, doc, orderBy } from 'firebase/firestore';
import type { User, P2PAd, Feedback } from '@/lib/types';
import { format, formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { DefaultAvatar } from '@/components/icons';
import { AdCard } from '@/components/p2p/ad-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, CheckCircle, Clock, DollarSign, ThumbsUp, ThumbsDown, FileText, UserX, UserCheck, ShieldOff } from 'lucide-react';
import { toDate, cn } from '@/lib/utils';
import { blockUser, unblockUser } from '@/lib/users';
import { useToast } from '@/hooks/use-toast';
import { FlagIcon } from '@/components/ui/flag-icon';
import { countries } from '@/lib/countries';
import { FeedbackCard } from '@/components/p2p/feedback-card';

function UserStats({ user }: { user: User }) {
  const lastTradeDate = toDate(user.lastTradeAt);
  return (
    <Card>
      <CardHeader>
        <CardTitle>User Statistics</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <div className="flex items-center gap-3">
          <DollarSign className="h-6 w-6 text-muted-foreground" />
          <div>
            <p className="text-sm text-muted-foreground">Trade Volume</p>
            <p className="font-semibold">${(user.tradeVolume || 0).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <CheckCircle className="h-6 w-6 text-muted-foreground" />
          <div>
            <p className="text-sm text-muted-foreground">Completed Trades</p>
            <p className="font-semibold">{user.completedTrades}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ThumbsUp className="h-6 w-6 text-muted-foreground" />
          <div>
            <p className="text-sm text-muted-foreground">Positive</p>
            <p className="font-semibold">{user.positiveFeedback || 0}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ThumbsDown className="h-6 w-6 text-muted-foreground" />
          <div>
            <p className="text-sm text-muted-foreground">Negative</p>
            <p className="font-semibold">{user.negativeFeedback || 0}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Clock className="h-6 w-6 text-muted-foreground" />
          <div>
            <p className="text-sm text-muted-foreground">Avg. Payment Time</p>
            <p className="font-semibold">{(user.avgPaymentTime || 0).toFixed(1)} min</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Clock className="h-6 w-6 text-muted-foreground" />
          <div>
            <p className="text-sm text-muted-foreground">Avg. Release Time</p>
            <p className="font-semibold">{(user.avgReleaseTime || 0).toFixed(1)} min</p>
          </div>
        </div>
        <div className="flex items-center gap-3 col-span-2">
          <Clock className="h-6 w-6 text-muted-foreground" />
          <div>
            <p className="text-sm text-muted-foreground">Last Trade</p>
            <p className="font-semibold">{lastTradeDate ? formatDistanceToNow(lastTradeDate) + ' ago' : 'N/A'}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}


export default function PublicProfilePage() {
  const params = useParams();
  const { firestore, user: authUser } = useFirebase();
  const { toast } = useToast();
  const username = Array.isArray(params.username) ? params.username[0] : params.username;

  const currentUserRef = useMemoFirebase(() => authUser ? doc(firestore, 'users', authUser.uid) : null, [firestore, authUser]);
  const { data: currentUserData } = useDoc<User>(currentUserRef);

  const userQuery = useMemoFirebase(
    () => (firestore && username ? query(collection(firestore, 'users'), where('userId', '==', username), limit(1)) : null),
    [firestore, username]
  );
  const { data: users, isLoading: isUserLoading } = useCollection<User>(userQuery);
  const user = users?.[0];
  
  const adsQuery = useMemoFirebase(
      () => (firestore && user ? query(collection(firestore, "p2p_ads"), where("userId", "==", user.id), where("active", "==", true)) : null),
      [firestore, user]
  );
  const { data: ads, isLoading: areAdsLoading } = useCollection<P2PAd>(adsQuery);

  const feedbackQuery = useMemoFirebase(
    () => (firestore && user ? query(collection(firestore, 'users', user.id, 'feedback'), orderBy('createdAt', 'desc')) : null),
    [firestore, user]
  );
  const { data: feedbacks, isLoading: areFeedbackLoading } = useCollection<Feedback>(feedbackQuery);

  const isBlockedByCurrentUser = currentUserData?.blockedUsers?.includes(user?.id || '');
  const isCurrentUserBlocked = user?.blockedUsers?.includes(currentUserData?.id || '');
  const isInteractionBlocked = !isUserLoading && (isBlockedByCurrentUser || isCurrentUserBlocked);

  const handleBlock = async () => {
    if (!firestore || !authUser || !user) return;
    try {
      await blockUser(firestore, authUser.uid, user.userId);
      toast({ title: "User Blocked", description: `You have blocked ${user.userId}.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Error", description: e.message });
    }
  };

  const handleUnblock = async () => {
    if (!firestore || !authUser || !user) return;
    try {
      await unblockUser(firestore, authUser.uid, user.id);
      toast({ title: "User Unblocked", description: `You have unblocked ${user.userId}.` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: "Error", description: e.message });
    }
  };

  if (isUserLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>User Not Found</CardTitle>
          <CardDescription>The user "{username}" does not exist.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const createdDate = toDate(user.createdAt);
  
  const lastActiveDate = user.lastActive ? toDate(user.lastActive) : null;
  let activity = { text: 'Offline', dotClass: 'bg-gray-500', textClass: 'text-muted-foreground' };

  if (lastActiveDate) {
    const diffMinutes = (new Date().getTime() - lastActiveDate.getTime()) / (1000 * 60);
    const formattedDistance = formatDistanceToNow(lastActiveDate);

    if (diffMinutes < 5) {
      activity = { text: 'Active now', dotClass: 'bg-green-500', textClass: 'text-green-600' };
    } else if (diffMinutes < 60) {
      activity = { text: `${formattedDistance} ago`, dotClass: 'bg-green-500', textClass: 'text-green-600' };
    } else if (diffMinutes < 24 * 60) {
      activity = { text: `${formattedDistance} ago`, dotClass: 'bg-yellow-600', textClass: 'text-yellow-600' };
    } else {
      activity = { text: `${formattedDistance} ago`, dotClass: 'bg-gray-500', textClass: 'text-muted-foreground' };
    }
  }

  const isOwnProfile = authUser?.uid === user.id;

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
            <Card>
                <CardContent className="pt-6 flex flex-col items-center text-center">
                    <Avatar className="h-32 w-32 mb-4 border-4 border-secondary shadow-lg">
                        {user.photoURL ? (
                            <AvatarImage src={user.photoURL} alt={user.userId} />
                        ) : (
                            <AvatarFallback className="bg-transparent">
                                <DefaultAvatar />
                            </AvatarFallback>
                        )}
                    </Avatar>
                    <div className="flex items-center gap-2">
                      <h1 className="text-2xl font-bold">{user.userId}</h1>
                      {user.country && <FlagIcon countryCode={user.country} className="w-6 h-auto" />}
                    </div>
                     <div className="flex gap-2 mt-2">
                        {user.isBanned && <Badge variant="destructive">Banned</Badge>}
                        {user.isOnHold && <Badge variant="secondary" className="bg-yellow-500 text-white">On Hold</Badge>}
                    </div>
                    
                    <div className="flex items-center justify-center gap-2 mt-2">
                        <div className={cn("h-2 w-2 rounded-full", activity.dotClass)} />
                        <p className={cn("text-sm", activity.textClass)}>
                            {activity.text}
                        </p>
                    </div>
                    
                    <p className="text-sm text-muted-foreground mt-2 flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        Joined {createdDate ? formatDistanceToNow(createdDate) + ' ago' : 'N/A'}
                    </p>
                    {!isOwnProfile && authUser && (
                      <div className="mt-4 w-full">
                        {isBlockedByCurrentUser ? (
                          <Button variant="outline" className="w-full" onClick={handleUnblock}>
                            <UserCheck className="mr-2 h-4 w-4" /> Unblock User
                          </Button>
                        ) : (
                          <Button variant="destructive" className="w-full" onClick={handleBlock}>
                            <UserX className="mr-2 h-4 w-4" /> Block User
                          </Button>
                        )}
                      </div>
                    )}
                </CardContent>
            </Card>
            <UserStats user={user} />
        </div>

        <div className="lg:col-span-2 space-y-6">
            {isInteractionBlocked ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Interaction Blocked</CardTitle>
                    </CardHeader>
                    <CardContent className="text-center py-10">
                        <ShieldOff className="mx-auto h-12 w-12 text-muted-foreground" />
                        <p className="mt-4 text-muted-foreground">You cannot view ads or trade with this user.</p>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                    <CardTitle>Active Ads</CardTitle>
                    <CardDescription>
                        P2P ads currently run by {user.userId}.
                    </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                    {areAdsLoading && <Skeleton className="h-32 w-full" />}
                    {!areAdsLoading && ads && ads.length > 0 ? (
                        ads.map(ad => {
                            // Enrich the ad's user object with live data from the profile
                            const enrichedAd = {
                                ...ad,
                                user: {
                                    ...ad.user, // Start with the ad's denormalized data
                                    // Overwrite with live data from the fetched user profile
                                    username: user.userId,
                                    feedbackScore: user.feedbackScore,
                                    positiveFeedback: user.positiveFeedback,
                                    negativeFeedback: user.negativeFeedback,
                                    completedTrades: user.completedTrades,
                                    photoURL: user.photoURL,
                                    badges: user.badges,
                                    lastActive: user.lastActive,
                                    country: user.country,
                                },
                            };
                            return <AdCard key={ad.id} ad={enrichedAd} />;
                        })
                    ) : (
                        <div className="text-center py-10 border-2 border-dashed rounded-lg">
                        <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-4 text-lg font-semibold">No Active Ads</h3>
                        <p className="mt-1 text-sm text-muted-foreground">{user.userId} does not have any active ads right now.</p>
                        </div>
                    )}
                    </CardContent>
                </Card>
            )}

            {!areFeedbackLoading && feedbacks && feedbacks.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Feedback</CardTitle>
                        <CardDescription>Feedback left by other traders for {user.userId}.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="divide-y">
                            {feedbacks.map(fb => <FeedbackCard key={fb.id} feedback={fb} />)}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
      </div>
    </>
  );
}
