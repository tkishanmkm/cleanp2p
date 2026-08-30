'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DefaultAvatar } from '@/components/icons';
import { Calendar, CheckCircle, ThumbsUp, ThumbsDown, ShieldBan, Globe, ArrowLeftRight, User as UserIcon } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toDate } from '@/lib/utils';
import type { User } from '@/lib/types';
import { countries } from '@/lib/countries';
import { ScrollArea } from '@/components/ui/scroll-area';

function DetailItem({ icon, label, value }: { icon: React.ReactNode, label: string, value: string | number | undefined }) {
    if (value === undefined || value === null) return null;
    return (<div className="flex items-center gap-3 py-2 border-b"><div className="text-muted-foreground">{icon}</div><div><p className="text-xs text-muted-foreground">{label}</p><p className="font-medium text-sm">{value}</p></div></div>);
}

export function CounterpartyInfoPanel({ user, open, onOpenChange, completedTradesWithUser }: { user: User | null | undefined; open: boolean; onOpenChange: (open: boolean) => void; completedTradesWithUser?: number; }) {
  if (!user) return null;
  const createdDate = toDate(user.createdAt);
  const joinedAgo = createdDate ? formatDistanceToNow(createdDate) + ' ago' : 'N/A';
  const dobDate = toDate(user.dob);

  const getCountryName = (code?: string) => code ? countries.find(c => c.code === code)?.name : 'N/A';


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex flex-col">
            <SheetHeader>
                <SheetTitle>Trader Information</SheetTitle>
                <SheetDescription>Details for {user.userId}</SheetDescription>
            </SheetHeader>
            <ScrollArea className="flex-grow">
              <div className="py-4 space-y-6 pr-6">
                  <div className="flex flex-col items-center gap-2">
                      <Avatar className="h-24 w-24 border-4 border-secondary">
                          <AvatarImage src={user.photoURL} />
                          <AvatarFallback><DefaultAvatar /></AvatarFallback>
                      </Avatar>
                      <h2 className="text-xl font-bold">{user.userId}</h2>
                  </div>
                  <div className="space-y-1">
                      <DetailItem icon={<UserIcon size={16} />} label="Full Name" value={user.fullName} />
                      <DetailItem icon={<Calendar size={16} />} label="Date of Birth" value={dobDate ? format(dobDate, 'LLLL d, yyyy') : 'N/A'} />
                      <DetailItem icon={<ArrowLeftRight size={16} />} label="Trades With You" value={completedTradesWithUser} />
                      <DetailItem icon={<Calendar size={16} />} label="Joined" value={joinedAgo} />
                      <DetailItem icon={<CheckCircle size={16} />} label="Completed Trades" value={user.completedTrades?.toLocaleString()} />
                      <DetailItem icon={<ThumbsUp size={16} />} label="Positive Feedback" value={`${user.feedbackScore || 100}% (${user.positiveFeedback || 0})`} />
                      <DetailItem icon={<ThumbsDown size={16} />} label="Negative Feedback" value={user.negativeFeedback || 0} />
                      <DetailItem icon={<ShieldBan size={16} />} label="Users Blocked by them" value={user.blockedUsers?.length || 0} />
                      <DetailItem icon={<Globe size={16} />} label="Country of Residence" value={getCountryName(user.country)} />
                      <DetailItem icon={<Globe size={16} />} label="IP-based Location" value={getCountryName(user.ipBasedCountry)} />
                      <p className="text-xs text-muted-foreground pt-2">Information on how many users have blocked this trader is not available.</p>
                  </div>
              </div>
            </ScrollArea>
        </SheetContent>
    </Sheet>
  );
}
