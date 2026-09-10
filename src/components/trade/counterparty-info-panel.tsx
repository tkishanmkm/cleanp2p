'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DefaultAvatar } from '@/components/icons';
import {
  Calendar,
  CheckCircle,
  ThumbsUp,
  ThumbsDown,
  ShieldBan,
  Globe,
  ArrowLeftRight,
  User as UserIcon,
  ShieldAlert,
  ShieldCheck,
  Ban,
  UserCheck,
  Loader2
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toDate } from '@/lib/utils';
import type { User } from '@/lib/types';
import { countries } from '@/lib/countries';
import { FlagIcon } from '@/components/ui/flag-icon';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';

function DetailItem({
  icon,
  label,
  value,
  highlight
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/50 text-sm">
      <div className="flex items-center gap-2.5 text-muted-foreground">
        <div className="text-primary shrink-0">{icon}</div>
        <span>{label}</span>
      </div>
      <div className={`font-semibold text-right ${highlight ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}

function CountryDisplay({ rawCodeOrName }: { rawCodeOrName?: string }) {
  if (!rawCodeOrName) return <span>N/A</span>;
  const match = countries.find(
    (c) =>
      c.code.toLowerCase() === rawCodeOrName.toLowerCase() ||
      c.name.toLowerCase() === rawCodeOrName.toLowerCase()
  );
  const code = match ? match.code : (rawCodeOrName.length === 2 ? rawCodeOrName.toUpperCase() : null);
  const name = match ? match.name : rawCodeOrName;

  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
      {code && <FlagIcon countryCode={code} className="h-3.5 w-5 rounded-xs" />}
      <span>{name}</span>
    </span>
  );
}

export function CounterpartyInfoPanel({
  user,
  open,
  onOpenChange,
  completedTradesWithUser
}: {
  user: User | any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completedTradesWithUser?: number;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const [profileData, setProfileData] = useState<any>(user);
  const [blockedByCount, setBlockedByCount] = useState<number>(0);
  const [isBlockedByMe, setIsBlockedByMe] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);

  useEffect(() => {
    setProfileData(user);
    if (!open || !user) return;

    const fetchLiveStats = async () => {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();

        const targetId = user.id || user.user_id || user.userId;
        const targetUsername = user.username || user.user_id || user.userId;

        let targetProfileId = targetId;

        let query = supabase.from('profiles').select('*');
        if (targetId && targetId.includes('-')) {
          query = query.eq('id', targetId);
        } else if (targetUsername) {
          query = query.eq('username', targetUsername);
        }

        const { data: prof, error } = await query.maybeSingle();
        if (!error && prof) {
          targetProfileId = prof.id;
          setProfileData((prev: any) => ({ ...prev, ...prof }));
        }

        // Live fetch actual completed trades count for target user from trades table
        if (targetProfileId) {
          const { count: exactTradesCount } = await supabase
            .from('trades')
            .select('*', { count: 'exact', head: true })
            .or(`buyer_id.eq.${targetProfileId},seller_id.eq.${targetProfileId}`)
            .eq('status', 'released');

          if (exactTradesCount !== null) {
            setProfileData((prev: any) => ({
              ...prev,
              completed_trades: exactTradesCount,
              completedTrades: exactTradesCount
            }));
          }
        }

        // Check if current user has blocked this user via api/user/block-status
        if (currentUser && targetProfileId) {
          try {
            const res = await fetch(`/api/user/block-status?targetId=${targetProfileId}`);
            const blockData = await res.json();
            if (typeof blockData.isBlockedByMe === 'boolean') {
              setIsBlockedByMe(blockData.isBlockedByMe);
            }
            if (typeof blockData.blockedByCount === 'number') {
              setBlockedByCount(blockData.blockedByCount);
            }
          } catch {
            const { data: myProfile } = await supabase
              .from('profiles')
              .select('blocked_users')
              .eq('id', currentUser.id)
              .maybeSingle();

            const myBlocked: string[] = Array.isArray(myProfile?.blocked_users) ? myProfile.blocked_users : [];
            setIsBlockedByMe(
              myBlocked.includes(targetProfileId) || 
              (targetId && myBlocked.includes(targetId)) ||
              (targetUsername ? myBlocked.includes(targetUsername) : false)
            );
          }
        }

        // Calculate how many distinct users have blocked this target user
        if (targetProfileId || targetId) {
          const { data: allProfiles } = await supabase
            .from('profiles')
            .select('id, blocked_users');

          if (allProfiles) {
            let count = 0;
            for (const p of allProfiles) {
              if (p.id === targetProfileId || p.id === targetId) continue;
              const blkList: string[] = Array.isArray(p.blocked_users) ? p.blocked_users : [];
              const isBlocking = blkList.some(
                (item) => item === targetProfileId || item === targetId || (targetUsername && item === targetUsername)
              );
              if (isBlocking) {
                count++;
              }
            }
            setBlockedByCount(count);
          }
        }

        // Fetch live feedback counts for this user directly from feedback table
        if (targetProfileId || targetId) {
          const effectiveId = targetProfileId || targetId;
          const { count: posCount } = await supabase
            .from('feedback')
            .select('*', { count: 'exact', head: true })
            .eq('to_user', effectiveId)
            .eq('rating', 'positive');

          const { count: negCount } = await supabase
            .from('feedback')
            .select('*', { count: 'exact', head: true })
            .eq('to_user', effectiveId)
            .eq('rating', 'negative');

          if (posCount !== null || negCount !== null) {
            setProfileData((prev: any) => ({
              ...prev,
              positive_feedback: posCount ?? prev?.positive_feedback ?? 0,
              negative_feedback: negCount ?? prev?.negative_feedback ?? 0,
              positiveFeedback: posCount ?? prev?.positiveFeedback ?? 0,
              negativeFeedback: negCount ?? prev?.negativeFeedback ?? 0
            }));
          }
        }
      } catch (err) {
        console.error('Error fetching counterparty stats:', err);
      }
    };

    fetchLiveStats();
  }, [open, user, supabase]);

  const handleToggleBlock = async () => {
    setIsBlocking(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error('Please sign in first');

      const targetId = profileData?.id || user?.id;
      const targetUser = profileData?.username || user?.username;
      const action = isBlockedByMe ? 'UNBLOCK' : 'BLOCK';

      const res = await fetch('/api/user/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: targetId,
          action,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update block state');
      }

      if (isBlockedByMe) {
        setIsBlockedByMe(false);
        setBlockedByCount((prev) => Math.max(0, prev - 1));
        toast({ title: 'User Unblocked', description: `You have unblocked @${targetUser || 'user'}` });
      } else {
        setIsBlockedByMe(true);
        setBlockedByCount((prev) => prev + 1);
        toast({ title: 'User Blocked', description: `You have blocked @${targetUser || 'user'}` });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'Failed to update block status' });
    } finally {
      setIsBlocking(false);
    }
  };

  if (!user && !profileData) return null;

  const current = profileData || user;
  const username = current.username || current.userId || current.user_id || 'Trader';
  const fullName = current.fullName || current.full_name || 'Unverified User';
  const photoURL = current.photoURL || current.photo_url;
  
  const createdDate = toDate(current.createdAt || current.created_at);
  const joinedAgo = createdDate ? formatDistanceToNow(createdDate) + ' ago' : 'N/A';
  const dobDate = toDate(current.dob);

  const getCountryName = (code?: string) => (code ? countries.find((c) => c.code === code)?.name || code : 'N/A');

  const positiveCount = Number(current.positiveFeedback ?? current.positive_feedback ?? 0);
  const negativeCount = Number(current.negativeFeedback ?? current.negative_feedback ?? 0);
  const totalFeedback = positiveCount + negativeCount;
  const positiveScore = totalFeedback > 0 ? Math.round((positiveCount / totalFeedback) * 100) : 100;

  const completedTradesCount = Number(current.completedTrades ?? current.completed_trades ?? 0);
  const rawBlockedList = Array.isArray(current.blockedUsers || current.blocked_users)
    ? (current.blockedUsers || current.blocked_users)
    : [];
  const blockedUsersCount = Array.from(new Set(rawBlockedList)).length;

  const countryCode = current.country;
  const ipCountryCode = current.ipBasedCountry || current.ip_based_country;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col w-full sm:max-w-md bg-card text-card-foreground border-l border-border">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle className="text-lg font-bold flex items-center gap-2">
            <UserIcon className="h-5 w-5 text-primary" />
            Trader Information
          </SheetTitle>
          <SheetDescription className="text-xs">
            Profile reputation and trade statistics for @{username}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 pr-4 -mr-4 my-2">
          <div className="py-3 space-y-5">
            {/* Header Avatar & Name */}
            <div className="flex flex-col items-center gap-2 text-center p-4 bg-muted/40 rounded-xl border border-border/50">
              <Avatar className="h-20 w-20 border-2 border-primary/40 shadow-xs">
                <AvatarImage src={photoURL} alt={username} />
                <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">
                  <DefaultAvatar />
                </AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-lg font-bold text-foreground">@{username}</h3>
                <p className="text-xs text-muted-foreground">{fullName}</p>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <ThumbsUp className="h-3 w-3" /> {positiveScore}% Positive
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                  <CheckCircle className="h-3 w-3" /> {completedTradesCount} Trades
                </span>
              </div>
            </div>

            {/* Detailed Stats List */}
            <div className="space-y-1">
              <DetailItem icon={<UserIcon size={16} />} label="Full Name" value={fullName} />
              
              {/* Verification Badges */}
              <div className="flex items-center justify-between py-2.5 border-b border-border/50 text-sm">
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                  <span>Email Verified</span>
                </div>
                <div>
                  {(current.email_verified || current.is_email_verified || current.emailVerified) ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <CheckCircle className="h-3 w-3" /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      Unverified
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between py-2.5 border-b border-border/50 text-sm">
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                  <span>ID / KYC Verified</span>
                </div>
                <div>
                  {(current.id_verified || current.kyc_status === 'verified' || current.is_id_verified || current.idVerified) ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <CheckCircle className="h-3 w-3" /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
                      Unverified
                    </span>
                  )}
                </div>
              </div>

              <DetailItem
                icon={<ArrowLeftRight size={16} />}
                label="Completed Trades With You"
                value={<span className="font-[Arial,Helvetica,sans-serif]">{completedTradesWithUser !== undefined ? completedTradesWithUser : 0}</span>}
                highlight
              />
              <DetailItem icon={<Calendar size={16} />} label="Member Since" value={joinedAgo} />
              <DetailItem
                icon={<CheckCircle size={16} />}
                label="All Completed Trades"
                value={<span className="font-[Arial,Helvetica,sans-serif]">{completedTradesCount.toLocaleString()}</span>}
              />
              <DetailItem
                icon={<ThumbsUp size={16} />}
                label="Positive Feedback"
                value={<span className="font-[Arial,Helvetica,sans-serif] text-emerald-600 dark:text-emerald-400 font-bold">{positiveCount} (+)</span>}
              />
              <DetailItem
                icon={<ThumbsDown size={16} />}
                label="Negative Feedback"
                value={<span className="font-[Arial,Helvetica,sans-serif] text-destructive font-bold">{negativeCount} (-)</span>}
              />
              <DetailItem
                icon={<ShieldBan size={16} />}
                label="Users Blocked by Them"
                value={<span className="font-[Arial,Helvetica,sans-serif]">{blockedUsersCount}</span>}
              />
              <DetailItem
                icon={<ShieldAlert size={16} />}
                label="Users Who Blocked Them"
                value={<span className="font-[Arial,Helvetica,sans-serif]">{blockedByCount}</span>}
              />
              <DetailItem
                icon={<Globe size={16} />}
                label="Country of Residence"
                value={<CountryDisplay rawCodeOrName={countryCode || current.country_of_residence || 'India'} />}
              />
              <DetailItem
                icon={<Globe size={16} />}
                label="IP-Based Location"
                value={<CountryDisplay rawCodeOrName={ipCountryCode || current.ip_country || 'India'} />}
              />
            </div>

            {/* Block / Unblock Action */}
            <div className="pt-2">
              <Button
                variant={isBlockedByMe ? 'outline' : 'destructive'}
                size="sm"
                className="w-full text-xs font-bold gap-2"
                onClick={handleToggleBlock}
                disabled={isBlocking}
              >
                {isBlocking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isBlockedByMe ? (
                  <>
                    <UserCheck className="h-4 w-4 text-emerald-500" />
                    Unblock @{username}
                  </>
                ) : (
                  <>
                    <Ban className="h-4 w-4" />
                    Block @{username}
                  </>
                )}
              </Button>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

export default CounterpartyInfoPanel;
