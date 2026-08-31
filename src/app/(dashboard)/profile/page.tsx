
"use client";

import { useAuth } from "@/components/providers/auth-provider";
import { useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import type { User } from "@/lib/types";
import { format, formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { DefaultAvatar } from "@/components/icons";
import { User as UserIcon, Calendar, CheckCircle, Clock, DollarSign, UserCheck, ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import { toDate } from "@/lib/utils";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

function DetailItem({ icon, label, value }: { icon: React.ReactNode, label: string, value: string | number | undefined}) {
    if (!value && value !== 0) return null;
    return (
        <div className="flex items-start gap-4">
            <div className="text-primary mt-1">{icon}</div>
            <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="font-medium">{value}</p>
            </div>
        </div>
    );
}

export default function ProfilePage() {
    const { user: authUser, profile, isUserLoading: isAuthLoading } = useAuth();
    const { firestore } = useFirebase();
    const router = useRouter();

    useEffect(() => {
        if (!isAuthLoading && !authUser) {
          router.push('/login');
        }
    }, [authUser, isAuthLoading, router]);
    
    const userRef = useMemoFirebase(() => authUser?.uid && firestore ? doc(firestore, "users", authUser.uid) : null, [authUser?.uid, firestore]);
    const { data: firestoreUser, isLoading: isUserLoading } = useDoc<User>(userRef);

    if (isAuthLoading || (!authUser && typeof window !== 'undefined')) {
        return (
             <div className="flex flex-1 items-center justify-center min-h-[300px]">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
             </div>
        );
    }

    if (!authUser) {
        return null;
    }

    const user = firestoreUser || {
        id: authUser.uid,
        userId: profile?.username || authUser.displayName || 'User',
        fullName: profile?.full_name || authUser.displayName || 'User',
        email: authUser.email,
        photoURL: profile?.avatar_url || authUser.photoURL || null,
        isBanned: false,
        isOnHold: false,
        tradeVolume: profile?.trade_volume || 0,
        completedTrades: profile?.completed_trades || 0,
        positiveFeedback: profile?.positive_feedback || 0,
        negativeFeedback: profile?.negative_feedback || 0,
        avgPaymentTime: 0,
        avgReleaseTime: 0,
        lastTradeAt: null,
        dob: null,
        createdAt: profile?.created_at || new Date().toISOString(),
        preferredCurrency: 'USD',
        wallets: {},
    };

    const lastTradeDate = toDate(user.lastTradeAt);
    const dobDate = toDate(user.dob);
    const createdDate = toDate(user.createdAt);

    return (
        <>
            <div className="flex items-center mb-6">
                <h1 className="text-lg font-semibold md:text-2xl">My Profile</h1>
            </div>
            <div className="grid gap-6 lg:grid-cols-3">
                <div className="lg:col-span-1 space-y-6">
                    <Card>
                        <CardContent className="pt-6 flex flex-col items-center text-center">
                            <Avatar className="h-32 w-32 mb-4 border-4 border-secondary shadow-lg">
                                {user.photoURL ? (
                                    <AvatarImage src={user.photoURL} alt={user.userId} className="object-cover"/>
                                ) : (
                                    <AvatarFallback className="bg-transparent">
                                        <DefaultAvatar />
                                    </AvatarFallback>
                                )}
                            </Avatar>
                            <h2 className="text-2xl font-bold">{user.userId}</h2>
                            <p className="text-muted-foreground">{user.fullName}</p>
                            <div className="flex gap-2 mt-4">
                                {user.isBanned && <Badge variant="destructive">Banned</Badge>}
                                {user.isOnHold && <Badge variant="secondary" className="bg-yellow-500 text-white">On Hold</Badge>}
                                {!user.isBanned && !user.isOnHold && <Badge className="bg-green-500">Active</Badge>}
                            </div>
                        </CardContent>
                    </Card>
                     <Card>
                        <CardHeader>
                            <CardTitle>Account Stats</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                             <DetailItem icon={<DollarSign size={20} />} label="Total Trade Volume" value={`$${(user.tradeVolume || 0).toLocaleString()}`} />
                             <DetailItem icon={<CheckCircle size={20} />} label="Completed Trades" value={user.completedTrades} />
                             <DetailItem icon={<ThumbsUp size={20} />} label="Positive Feedback" value={user.positiveFeedback || 0} />
                             <DetailItem icon={<ThumbsDown size={20} />} label="Negative Feedback" value={user.negativeFeedback || 0} />
                             <DetailItem icon={<Clock size={20} />} label="Avg. Payment Time" value={`${(user.avgPaymentTime || 0).toFixed(1)} min`} />
                             <DetailItem icon={<Clock size={20} />} label="Avg. Release Time" value={`${(user.avgReleaseTime || 0).toFixed(1)} min`} />
                             <DetailItem icon={<Clock size={20} />} label="Last Trade" value={lastTradeDate ? format(lastTradeDate, "PPpp") : 'No trades yet'} />
                        </CardContent>
                    </Card>
                </div>
                <div className="lg:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>User Information</CardTitle>
                            <CardDescription>This information is private and not shared with other traders.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-6">
                           <DetailItem icon={<UserIcon size={20} />} label="Full Name" value={user.fullName} />
                           <DetailItem icon={<UserCheck size={20} />} label="User ID" value={user.userId} />
                           {user.oldUserId && <DetailItem icon={<UserIcon size={20} />} label="Previous User ID" value={user.oldUserId} />}
                           <DetailItem icon={<Calendar size={20} />} label="Date of Birth" value={dobDate ? format(dobDate, "LLLL d, yyyy") : 'N/A'} />
                           <DetailItem icon={<Clock size={20} />} label="Member Since" value={createdDate ? `${format(createdDate, "PP")} (${formatDistanceToNow(createdDate)} ago)` : 'N/A'} />
                           <DetailItem icon={<DollarSign size={20} />} label="Preferred Currency" value={user.preferredCurrency || 'USD'} />
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
}
