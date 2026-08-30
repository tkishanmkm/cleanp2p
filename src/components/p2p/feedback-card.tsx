
'use client';
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { formatDistanceToNow } from 'date-fns';
import { toDate } from "@/lib/utils";
import type { Feedback, User } from "@/lib/types";
import { FlagIcon } from "../ui/flag-icon";
import { useDoc, useMemoFirebase, useFirebase } from "@/firebase";
import { doc } from "firebase/firestore";

export function FeedbackCard({ feedback }: { feedback: Feedback }) {
    const { firestore } = useFirebase();

    // Fetch user data to get the country code for the flag
    const fromUserRef = useMemoFirebase(() => (firestore && feedback.fromUser ? doc(firestore, 'users', feedback.fromUser) : null), [firestore, feedback.fromUser]);
    const { data: fromUser } = useDoc<User>(fromUserRef);
    
    return (
        <div className="p-4">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm">{feedback.fromUsername}</p>
                    {fromUser?.country && <FlagIcon countryCode={fromUser.country} />}
                </div>
                <div className="flex items-center gap-1 text-sm">
                    {feedback.rating === 'positive' ? (
                        <ThumbsUp className="h-4 w-4 text-green-500" />
                    ) : (
                        <ThumbsDown className="h-4 w-4 text-red-500" />
                    )}
                    <span className={feedback.rating === 'positive' ? 'text-green-600 capitalize' : 'text-red-600 capitalize'}>
                        {feedback.rating}
                    </span>
                </div>
            </div>
            <p className="text-sm mb-2">{feedback.comment}</p>
            <div className="flex items-center justify-end text-xs text-muted-foreground">
                <span>{toDate(feedback.createdAt) ? formatDistanceToNow(toDate(feedback.createdAt)!) + ' ago' : ''}</span>
            </div>
        </div>
    );
}
