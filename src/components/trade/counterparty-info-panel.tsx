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
import { formatDistanceToNow } from 'date-fns';
import { ar, enUS, es, fr, hi, ko, ptBR, ru, vi, zhCN, zhTW } from 'date-fns/locale';
import { toDate } from '@/lib/utils';
import type { User } from '@/lib/types';
import { countries } from '@/lib/countries';
import { FlagIcon } from '@/components/ui/flag-icon';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/context/i18n-context';

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
  completedTradesWithUser,
  activeTradeId
}: {
  user: User | any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  completedTradesWithUser?: number;
  activeTradeId?: string;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const { t, language } = useI18n();
  const dateFnsLocaleByLanguage = { en: enUS, 'zh-CN': zhCN, 'zh-TW': zhTW, 'pt-BR': ptBR, ko, fr, es, ru, vi, ar, hi };
  const dateFnsLocale = dateFnsLocaleByLanguage[language as keyof typeof dateFnsLocaleByLanguage] || enUS;
  const [profileData, setProfileData] = useState<any>(user);
  const [blockedByCount, setBlockedByCount] = useState<number>(0);
  const [usersBlockedCount, setUsersBlockedCount] = useState<number>(0);
  const [isBlockedByMe, setIsBlockedByMe] = useState(false);
  const [isBlockedByThem, setIsBlockedByThem] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const [isBlocking, setIsBlocking] = useState(false);

  useEffect(() => {
    setProfileData(user);
    if (!open || !user) return;

    const fetchLiveStats = async () => {
      setIsCheckingStatus(true);
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();

        const targetId = user.id || (typeof user.userId === 'string' && user.userId.includes('-') ? user.userId : undefined);
        const targetUsername = user.username || (typeof user.userId === 'string' && !user.userId.includes('-') ? user.userId : undefined);

        let targetProfileId = targetId;

        const COUNTERPARTY_PROFILE_FIELDS = 'id, username, display_name, avatar_url, photo_url, is_online, created_at, total_completed_trades, completed_trades, positive_feedback, negative_feedback, feedback_score';
        let query = supabase.from('public_profiles').select(COUNTERPARTY_PROFILE_FIELDS);
        if (targetId && targetId.includes('-')) {
          query = query.eq('id', targetId);
        } else if (targetUsername) {
          query = query.eq('username', targetUsername);
        }

        const { data: prof, error } = await query.maybeSingle();
        if (!error && prof) {
          targetProfileId = prof.id;
          setProfileData((prev: any) => ({ ...prev, ...prof }));

          // Block relationships are resolved by the authenticated server endpoint;
          // never read another user's private block list from the browser.
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
            if (typeof blockData.theyBlockedYou === 'boolean') {
              setIsBlockedByThem(blockData.theyBlockedYou);
            }
            if (typeof blockData.blockedByCount === 'number') {
              setBlockedByCount(blockData.blockedByCount);
            }
            if (typeof blockData.usersBlockedCount === 'number') {
              setUsersBlockedCount(blockData.usersBlockedCount);
            }
          } catch {
            // Fail closed for block-sensitive actions when the status endpoint is unavailable.
            setIsBlockedByMe(true);
            setIsBlockedByThem(false);
          }
        }

        // Aggregated block counts are returned by the server-only block-status
        // endpoint; the browser never enumerates other users' private block lists.

        // Fetch live feedback counts for this user directly from feedback table
        const effectiveId = targetProfileId || targetId;
        if (effectiveId) {
          const { data: fbData } = await supabase
            .from('feedback')
            .select('rating, is_positive')
            .eq('to_user', effectiveId);

          if (fbData) {
            const posCount = fbData.filter((f) => f.is_positive === true || f.is_positive === 'true' || f.rating === 'positive').length;
            const negCount = fbData.filter((f) => f.is_positive === false || f.is_positive === 'false' || f.rating === 'negative').length;
            setProfileData((prev: any) => ({
              ...prev,
              positive_feedback: posCount,
              negative_feedback: negCount,
              positiveFeedback: posCount,
              negativeFeedback: negCount
            }));
          }
        }
      } catch (err) {
        console.error('Error fetching counterparty stats:', err);
      } finally {
        setIsCheckingStatus(false);
      }
    };

    fetchLiveStats();
  }, [open, user, supabase]);

  const handleToggleBlock = async () => {
    setIsBlocking(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) throw new Error(t('counterpartyPanel.notSignedIn'));

      const targetId = profileData?.id || user?.id;
      const targetUser = profileData?.username || user?.username;
      const action = isBlockedByMe ? 'UNBLOCK' : 'BLOCK';

      const res = await fetch('/api/user/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: targetId,
          action,
          activeTradeId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t('counterpartyPanel.updateBlockFailed'));
      }

      if (isBlockedByMe) {
        setIsBlockedByMe(false);
        setBlockedByCount((prev) => Math.max(0, prev - 1));
        toast({ title: t('counterpartyPanel.unblockedToast'), description: t('counterpartyPanel.unblockedDescription').replace('{username}', targetUser || 'user') });
      } else {
        setIsBlockedByMe(true);
        setBlockedByCount((prev) => prev + 1);
        toast({ title: t('counterpartyPanel.blockedToast'), description: t('counterpartyPanel.blockedDescription').replace('{username}', targetUser || 'user') });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: t('counterpartyPanel.errorTitle'), description: err.message || t('counterpartyPanel.updateBlockFailed') });
    } finally {
      setIsBlocking(false);
    }
  };

  if (!user && !profileData) return null;

  const current = profileData || user;
  const username = current.username || (current.userId && !current.userId.includes('-') ? current.userId : t('counterpartyPanel.fallbackTrader'));
  // Public trader projections expose display_name, never legal full_name.
  const displayName = current.display_name || username || t('counterpartyPanel.fallbackUnverifiedUser');
  const photoURL = current.photoURL || current.photo_url;
  
  const createdDate = toDate(current.createdAt || current.created_at);
  const joinedAgo = createdDate ? formatDistanceToNow(createdDate, { addSuffix: true, locale: dateFnsLocale }) : t('counterpartyPanel.notAvailable');

  const getCountryName = (code?: string) => (code ? countries.find((c) => c.code === code)?.name || code : 'N/A');

  const positiveCount = Number(current.positiveFeedback ?? current.positive_feedback ?? 0);
  const negativeCount = Number(current.negativeFeedback ?? current.negative_feedback ?? 0);
  const totalFeedback = positiveCount + negativeCount;
  const positiveScore = totalFeedback > 0 ? Math.round((positiveCount / totalFeedback) * 100) : 100;

  const completedTradesCount = Number(current.completedTrades ?? current.completed_trades ?? 0);
  // The server-only block-status endpoint supplies aggregate block counts.

  const countryCode = current.country;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col w-full sm:max-w-md bg-card text-card-foreground border-l border-border">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle className="text-lg font-bold flex items-center gap-2">
            <UserIcon className="h-5 w-5 text-primary" />
            {t('counterpartyPanel.title')}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {t('counterpartyPanel.description').replace('{username}', username)}
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
                <p className="text-xs text-muted-foreground">{displayName}</p>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <ThumbsUp className="h-3 w-3" /> {t('counterpartyPanel.positivePercent').replace('{count}', String(positiveScore))}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                  <CheckCircle className="h-3 w-3" /> {t('counterpartyPanel.tradesCount').replace('{count}', completedTradesCount.toLocaleString(language))}
                </span>
              </div>
            </div>

            {/* Detailed Stats List */}
            <div className="space-y-1">
              <DetailItem icon={<UserIcon size={16} />} label={t('counterpartyPanel.fullName')} value={displayName} />
              
              {/* Only the public projection's verified flag is displayed. Email
                  confirmation and detailed KYC lifecycle metadata stay private. */}
              <div className="flex items-center justify-between py-2.5 border-b border-border/50 text-sm">
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                  <span>{t('counterpartyPanel.idKycVerified')}</span>
                </div>
                <div>
                  {(
                    current.is_verified === true
                  ) ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <CheckCircle className="h-3 w-3" /> {t('counterpartyPanel.verified')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
                      {t('counterpartyPanel.unverified')}
                    </span>
                  )}
                </div>
              </div>

              <DetailItem
                icon={<ArrowLeftRight size={16} />}
                label={t('counterpartyPanel.completedWithYou')}
                value={<span className="font-[Arial,Helvetica,sans-serif]">{completedTradesWithUser !== undefined ? completedTradesWithUser : 0}</span>}
                highlight
              />
              <DetailItem icon={<Calendar size={16} />} label={t('counterpartyPanel.memberSince')} value={joinedAgo} />
              <DetailItem
                icon={<CheckCircle size={16} />}
                label={t('counterpartyPanel.allCompletedTrades')}
                value={<span className="font-[Arial,Helvetica,sans-serif]">{completedTradesCount.toLocaleString(language)}</span>}
              />
              <DetailItem
                icon={<ThumbsUp size={16} />}
                label={t('counterpartyPanel.positiveFeedback')}
                value={<span className="font-[Arial,Helvetica,sans-serif] text-emerald-600 dark:text-emerald-400 font-bold">{positiveCount} (+)</span>}
              />
              <DetailItem
                icon={<ThumbsDown size={16} />}
                label={t('counterpartyPanel.negativeFeedback')}
                value={<span className="font-[Arial,Helvetica,sans-serif] text-destructive font-bold">{negativeCount} (-)</span>}
              />
              <DetailItem
                icon={<ShieldBan size={16} />}
                label={t('counterpartyPanel.blockedByThem')}
                value={<span className="font-[Arial,Helvetica,sans-serif]">{usersBlockedCount}</span>}
              />
              <DetailItem
                icon={<ShieldAlert size={16} />}
                label={t('counterpartyPanel.blockedThem')}
                value={<span className="font-[Arial,Helvetica,sans-serif]">{blockedByCount}</span>}
              />
              <DetailItem
                icon={<Globe size={16} />}
                label={t('counterpartyPanel.residence')}
                value={<CountryDisplay rawCodeOrName={countryCode || 'N/A'} />}
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
                    {t('counterpartyPanel.unblockAction').replace('{username}', username)}
                  </>
                ) : (
                  <>
                    <Ban className="h-4 w-4" />
                    {t('counterpartyPanel.blockAction').replace('{username}', username)}
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
