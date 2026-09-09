'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useStopwatch } from '@/hooks/use-stopwatch';
import { addReceiptToTrade, claimFundsForTrade } from '@/lib/wallet';
import { compressImage } from '@/lib/media-compression';
import { cn, toDate } from '@/lib/utils';
import type { Trade, User, TradeChatMessage } from '@/lib/types';

import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { DefaultAvatar, BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { Logo } from '@/components/logo';
import { FlagIcon } from '@/components/ui/flag-icon';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Clock,
  Send,
  Plus,
  Info as InfoIcon,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Paperclip,
  Lock,
  Eye,
  FileCheck,
  FileText,
  Video,
  ShieldCheck,
  AlertTriangle
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

function CoinInsignia({ symbol, className = "h-4 w-4" }: { symbol: string; className?: string }) {
  const s = (symbol || '').toUpperCase();
  switch (s) {
    case 'BTC':
      return (
        <span className="inline-flex items-center gap-1 font-bold font-mono">
          <BtcLogo className={className} />
          <span>BTC</span>
        </span>
      );
    case 'ETH':
      return (
        <span className="inline-flex items-center gap-1 font-bold font-mono">
          <EthLogo className={className} />
          <span>ETH</span>
        </span>
      );
    case 'USDT':
      return (
        <span className="inline-flex items-center gap-1 font-bold font-mono">
          <UsdtLogo className={className} />
          <span>USDT</span>
        </span>
      );
    case 'LTC':
      return (
        <span className="inline-flex items-center gap-1 font-bold font-mono">
          <LtcLogo className={className} />
          <span>LTC</span>
        </span>
      );
    default:
      return <span className="font-bold font-mono">{symbol}</span>;
  }
}

function TradeInstructions({ trade, isBuyer }: { trade: Trade | any; isBuyer: boolean }) {
  const coinAmount = Number(trade?.amount ?? trade?.crypto_amount ?? 0).toFixed(8);
  const coinSymbol = trade?.crypto ?? trade?.asset_symbol ?? 'BTC';
  const fiatAmount = Number(trade?.fiatAmount ?? trade?.fiat_amount ?? trade?.amount_usd ?? 0).toLocaleString();
  const fiatCurrency = trade?.fiatCurrency ?? trade?.fiat_currency ?? trade?.fiat_symbol ?? 'USD';

  const title = isBuyer
    ? `You're buying ${coinAmount} ${coinSymbol} for ${fiatAmount} ${fiatCurrency}.`
    : `You're selling ${coinAmount} ${coinSymbol} for ${fiatAmount} ${fiatCurrency}.`;

  const buyerInstructions = [
    'Wait for the seller to provide their payment details in the chat.',
    'Make your payment using the details provided.',
    "Mark the trade as 'Paid' and upload proof of payment if requested.",
    'Wait for your trade partner to confirm receipt in their account.',
    'Your trade partner will release the coin from escrow.'
  ];
  const sellerInstructions = [
    'Share your payment instructions in the chat.',
    'Wait for the buyer to make the payment.',
    'Once payment is received in your account, release the coin.',
    'Do not release funds based on payment proof alone. Always check your bank/wallet.',
    "If the buyer doesn't pay within the countdown, the trade will automatically expire."
  ];

  const instructions = isBuyer ? buyerInstructions : sellerInstructions;

  return (
    <Alert className="bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200">
      <InfoIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
      <AlertTitle className="font-bold text-xs sm:text-sm">{title}</AlertTitle>
      <AlertDescription className="text-xs mt-1">
        <p className="font-medium">Coin deposit is locked securely in Escrow.</p>
        <ol className="list-decimal list-inside space-y-0.5 text-[11px] sm:text-xs mt-1.5 opacity-90">
          {instructions.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </AlertDescription>
    </Alert>
  );
}

function SystemMessage({
  title,
  children,
  timestamp,
  variant
}: {
  title: string;
  children: React.ReactNode;
  timestamp?: string;
  variant?: 'default' | 'destructive' | 'success' | 'warning' | 'info';
}) {
  const timeString = toDate(timestamp)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) || '';

  const variants = {
    default: 'bg-muted/80 border-border text-foreground',
    destructive: 'bg-destructive/10 border-destructive/30 text-destructive',
    success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
    warning: 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300',
    info: 'bg-primary/10 border-primary/30 text-primary'
  };

  return (
    <div className={cn('text-center text-xs p-3 rounded-xl border my-2', variants[variant || 'default'])}>
      <p className="font-bold mb-1 flex items-center justify-center gap-1.5">{title}</p>
      <div className="text-left text-xs whitespace-pre-wrap leading-relaxed">{children}</div>
      <p className="text-right text-[10px] opacity-70 mt-1 font-mono">{timeString}</p>
    </div>
  );
}

const TradeSummaryBar = ({ trade, currentUserRole }: { trade: Trade | any; currentUserRole: 'buy' | 'sell' }) => {
  const isBuyer = currentUserRole === 'buy';
  const roleText = isBuyer ? 'Buying' : 'Selling';

  const coinAmount = Number(trade?.amount ?? trade?.crypto_amount ?? 0).toFixed(8);
  const coinSymbol = trade?.crypto ?? trade?.asset_symbol ?? 'BTC';
  const fiatAmount = Number(trade?.fiatAmount ?? trade?.fiat_amount ?? trade?.amount_usd ?? 0).toLocaleString();
  const fiatCurrency = trade?.fiatCurrency ?? trade?.fiat_currency ?? trade?.fiat_symbol ?? 'USD';

  return (
    <div
      className={cn(
        'px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold border flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 shadow-xs transition-all',
        isBuyer
          ? 'bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
          : 'bg-rose-500/10 dark:bg-rose-500/15 border-rose-500/30 text-rose-800 dark:text-rose-300'
      )}
    >
      <span className="font-bold tracking-tight">{roleText}</span>
      <span className="font-serif tabular-nums font-bold tracking-tight">{coinAmount}</span>
      <CoinInsignia symbol={coinSymbol} className="h-4 w-4" />
      <span className="font-medium opacity-90">for</span>
      <span className="font-serif tabular-nums font-bold tracking-tight">
        {fiatAmount}
      </span>
      <span className="font-sans font-bold">{fiatCurrency}</span>
    </div>
  );
};

export function TradeChat({
  currentUserId,
  trade,
  opponent,
  isAdmin,
  sellerTerms,
  onInfoClick
}: {
  currentUserId: string;
  trade: Trade | any;
  opponent: User | any;
  isAdmin: boolean;
  sellerTerms?: string;
  onInfoClick: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [areMessagesLoading, setAreMessagesLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dispute privacy modal state
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [disputeVisibility, setDisputeVisibility] = useState<'all' | 'moderator_only'>('all');
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);

  const tradeStatus = (trade?.status || 'active').toLowerCase();
  const isTradeStopped = ['released', 'cancelled', 'expired', 'completed'].includes(tradeStatus);
  const isDisputed = ['disputed', 'dispute'].includes(tradeStatus);

  // Freeze stopwatch at exact finish time (Instruction 7)
  const stopEndTime = trade?.releasedAt || trade?.released_at || trade?.cancelledAt || trade?.cancelled_at || trade?.updated_at;
  const stopwatch = useStopwatch(trade?.createdAt || trade?.created_at || Date.now(), isTradeStopped, stopEndTime);

  const tradeId = trade?.id;
  const isBuyer = currentUserId === (trade?.buyerId || trade?.buyer_id);

  // Fetch initial messages & subscribe to Realtime
  useEffect(() => {
    if (!tradeId) return;

    const fetchMessages = async () => {
      setAreMessagesLoading(true);
      const { data, error } = await supabase
        .from('trade_messages')
        .select('*')
        .eq('trade_id', tradeId)
        .order('created_at', { ascending: true });

      if (error) {
        toast({ variant: 'destructive', title: 'Error loading messages', description: error.message });
      } else {
        setMessages(
          (data || []).map((m: any) => ({
            id: m.id,
            tradeId: m.trade_id,
            senderId: m.sender_id,
            senderUsername: m.sender_username,
            message: m.message,
            mediaUrl: m.media_url,
            mediaType: m.media_type,
            visibility: m.visibility || 'all',
            isModerator: Boolean(m.is_moderator),
            createdAt: m.created_at
          }))
        );
      }
      setAreMessagesLoading(false);
    };

    fetchMessages();

    const channelTopic = `trade-chat-${tradeId}-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelTopic)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trade_messages', filter: `trade_id=eq.${tradeId}` },
        (payload) => {
          const raw = payload.new as any;
          const formatted: any = {
            id: raw.id,
            tradeId: raw.trade_id,
            senderId: raw.sender_id,
            senderUsername: raw.sender_username,
            message: raw.message,
            mediaUrl: raw.media_url,
            mediaType: raw.media_type,
            visibility: raw.visibility || 'all',
            isModerator: Boolean(raw.is_moderator),
            createdAt: raw.created_at
          };
          setMessages((prev) => [...prev, formatted]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tradeId, supabase, toast]);

  const displayMessages = useMemo(() => {
    if (!messages) return [];
    const allMessages = [...messages];
    allMessages.sort((a, b) => (toDate(a.createdAt)?.getTime() ?? 0) - (toDate(b.createdAt)?.getTime() ?? 0));
    return allMessages;
  }, [messages]);

  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [displayMessages]);

  useEffect(() => {
    if (tradeStatus === 'released' && !trade?.claimedByBuyer && !trade?.claimed_by_buyer && isBuyer) {
      const claim = async () => {
        try {
          await claimFundsForTrade(supabase, trade, currentUserId);
          toast({ title: 'Funds Claimed', description: 'The crypto has been credited to your wallet.' });
        } catch (error: any) {
          console.error('Auto-claiming funds failed:', error);
        }
      };
      claim();
    }
  }, [tradeStatus, trade, isBuyer, currentUserId, supabase, toast]);

  const handleSendMessage = async (
    e?: React.FormEvent,
    mediaUrl?: string,
    mediaType?: 'image' | 'video' | 'document' | 'none',
    visibility: 'all' | 'moderator_only' = 'all'
  ) => {
    if (e) e.preventDefault();
    if (!newMessage.trim() && !mediaUrl) return;

    const blockedWords = ['telegram', 'whatsapp', 'phone', 'contact'];
    if (newMessage && blockedWords.some((word) => newMessage.toLowerCase().includes(word))) {
      toast({
        variant: 'destructive',
        title: 'Message Blocked',
        description: 'Please do not share external contact information in the encrypted escrow chat.'
      });
      return;
    }

    const messageToSend = newMessage.trim();
    setNewMessage('');

    try {
      const { error } = await supabase.from('trade_messages').insert([
        {
          trade_id: tradeId,
          sender_id: currentUserId,
          sender_username: opponent?.username || opponent?.userId || 'Trader',
          message: messageToSend,
          is_moderator: isAdmin,
          media_url: mediaUrl || null,
          media_type: mediaType || 'none',
          visibility,
          created_at: new Date().toISOString()
        }
      ]);

      if (error) throw error;

      if (mediaUrl && (tradeStatus === 'active' || tradeStatus === 'pending')) {
        await addReceiptToTrade(tradeId, mediaUrl);
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Send Failed', description: error.message });
    }
  };

  const processAndUploadFile = async (fileToUpload: File, chosenVisibility: 'all' | 'moderator_only') => {
    setIsUploading(true);
    try {
      // 1. Image compression (Instruction 8)
      let finalFile = fileToUpload;
      if (fileToUpload.type.startsWith('image/')) {
        finalFile = await compressImage(fileToUpload);
      }

      // 2. Video 30MB validation
      if (fileToUpload.type.startsWith('video/') && fileToUpload.size > 30 * 1024 * 1024) {
        throw new Error('Video exceeds maximum 30 MB size limit.');
      }

      // 3. Upload to Backblaze B2 via API endpoint
      const formData = new FormData();
      formData.append('file', finalFile);
      formData.append('tradeId', tradeId);
      formData.append('senderId', currentUserId);
      formData.append('visibility', chosenVisibility);

      const res = await fetch('/api/upload/trade-media', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to upload media to Backblaze B2');
      }

      await handleSendMessage(undefined, data.url, data.mediaType, chosenVisibility);
      toast({
        title: 'Media Uploaded',
        description: `Uploaded to Backblaze B2 (${chosenVisibility === 'moderator_only' ? 'Moderator Only' : 'Public to Counterpart'})`
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Upload Failed', description: err.message });
    } finally {
      setIsUploading(false);
      setPendingUploadFile(null);
      setIsPrivacyModalOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if in dispute mode
    if (isDisputed) {
      setPendingUploadFile(file);
      setIsPrivacyModalOpen(true);
    } else {
      await processAndUploadFile(file, 'all');
    }
  };

  const opponentUsername = opponent?.username || opponent?.userId || opponent?.user_id || 'Trader';
  const opponentPhoto = opponent?.photoURL || opponent?.photo_url;
  const positiveFeedback = Number(opponent?.positiveFeedback ?? opponent?.positive_feedback ?? 0);
  const negativeFeedback = Number(opponent?.negativeFeedback ?? opponent?.negative_feedback ?? 0);

  const opponentLastActive = opponent?.lastActive ? toDate(opponent.lastActive) : opponent?.last_active ? toDate(opponent.last_active) : null;
  let activity = { text: 'Offline', dotClass: 'bg-gray-500', textClass: 'text-muted-foreground' };

  if (opponentLastActive) {
    const diffMinutes = (new Date().getTime() - opponentLastActive.getTime()) / (1000 * 60);
    const formattedDistance = formatDistanceToNow(opponentLastActive);

    if (diffMinutes < 5) {
      activity = { text: 'Active now', dotClass: 'bg-emerald-500', textClass: 'text-emerald-600 dark:text-emerald-400' };
    } else {
      activity = { text: `${formattedDistance} ago`, dotClass: 'bg-emerald-500', textClass: 'text-emerald-600 dark:text-emerald-400' };
    }
  }

  return (
    <Card className="flex flex-col h-full shadow-none border-0 rounded-none bg-card text-card-foreground">
      <CardHeader className="space-y-3 border-b border-border/60 p-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Link href={`/users/${opponentUsername}`}>
              <Avatar className="h-10 w-10 border border-primary/20">
                <AvatarImage src={opponentPhoto} alt={opponentUsername} />
                <AvatarFallback className="bg-primary/10 text-primary font-bold">
                  <DefaultAvatar />
                </AvatarFallback>
              </Avatar>
            </Link>
            <div>
              <div className="flex items-center gap-1.5">
                <Link href={`/users/${opponentUsername}`} className="font-bold text-sm text-foreground hover:underline">
                  @{opponentUsername}
                </Link>
                {opponent?.country && <FlagIcon countryCode={opponent.country} />}
                <Button variant="ghost" size="icon" onClick={onInfoClick} className="h-6 w-6 text-primary hover:text-primary">
                  <InfoIcon className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <div className={cn('h-2 w-2 rounded-full', activity.dotClass)} />
                <p className={cn('text-xs font-medium', activity.textClass)}>{activity.text}</p>
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="flex items-center gap-3 text-xs justify-end font-semibold">
              <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <ThumbsUp className="h-3.5 w-3.5" />
                <span>{positiveFeedback}</span>
              </div>
              <div className="flex items-center gap-1 text-destructive">
                <ThumbsDown className="h-3.5 w-3.5" />
                <span>{negativeFeedback}</span>
              </div>
            </div>
            <div className="text-xs font-semibold font-mono flex items-center gap-1.5 justify-end mt-1 text-primary">
              <Clock className="h-3.5 w-3.5" />
              {stopwatch}
            </div>
          </div>
        </div>

        <TradeSummaryBar trade={trade} currentUserRole={isBuyer ? 'buy' : 'sell'} />
      </CardHeader>

      {/* Independent Scrollable Chat Area */}
      <CardContent className="flex-1 overflow-hidden p-4 min-h-0">
        <ScrollArea className="h-full pr-3" ref={scrollAreaRef}>
          <div className="space-y-4">
            <TradeInstructions trade={trade} isBuyer={isBuyer} />

            {sellerTerms && (
              <SystemMessage title="Seller's Terms & Conditions" timestamp={trade?.createdAt || trade?.created_at}>
                <p className="whitespace-pre-wrap">{sellerTerms}</p>
              </SystemMessage>
            )}

            {areMessagesLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-14 w-3/4" />
                <Skeleton className="h-14 w-3/4 ml-auto" />
              </div>
            ) : (
              <div className="space-y-3">
                {displayMessages.map((msg) => {
                  if (msg.senderId === 'system') {
                    const text = msg.message || '';
                    if (text.includes('positive feedback')) {
                      return (
                        <SystemMessage key={msg.id} title="🌟 Positive Feedback Received" timestamp={msg.createdAt} variant="success">
                          {text}
                        </SystemMessage>
                      );
                    }
                    if (text.includes('negative feedback')) {
                      return (
                        <SystemMessage key={msg.id} title="👎 Negative Feedback Received" timestamp={msg.createdAt} variant="destructive">
                          {text}
                        </SystemMessage>
                      );
                    }
                    if (text.includes('feedback')) {
                      return (
                        <SystemMessage key={msg.id} title="🌟 Trade Feedback" timestamp={msg.createdAt} variant="success">
                          {text}
                        </SystemMessage>
                      );
                    }
                    if (text.includes('reported an issue') || text.includes('Issue Reported') || text.includes('dispute') || text.includes('disputed')) {
                      return (
                        <SystemMessage key={msg.id} title="⚠️ Issue / Dispute Notice" timestamp={msg.createdAt} variant="warning">
                          {text}
                        </SystemMessage>
                      );
                    }
                    if (text.includes('complete') || text.includes('released')) {
                      return (
                        <SystemMessage key={msg.id} title="✅ Trade Completed" timestamp={msg.createdAt} variant="success">
                          {text}
                        </SystemMessage>
                      );
                    }
                    if (text.toLowerCase().includes('cancelled') || text.toLowerCase().includes('expired')) {
                      return (
                        <SystemMessage key={msg.id} title="❌ Trade Cancelled" timestamp={msg.createdAt} variant="destructive">
                          {text}
                        </SystemMessage>
                      );
                    }
                    if (text.includes('Paid')) {
                      return (
                        <SystemMessage key={msg.id} title="💵 Marked as Paid" timestamp={msg.createdAt} variant="info">
                          {text}
                        </SystemMessage>
                      );
                    }
                    return (
                      <SystemMessage key={msg.id} title="System Message" timestamp={msg.createdAt}>
                        {text}
                      </SystemMessage>
                    );
                  }

                  const isCurrentUser = msg.senderId === currentUserId;
                  const isModeratorOnly = msg.visibility === 'moderator_only';
                  const canViewModeratorFile = isAdmin || isCurrentUser;

                  let senderDisplayName = isCurrentUser ? 'You' : `@${opponentUsername}`;
                  if (msg.isModerator) senderDisplayName = 'Pax Moderator';

                  return (
                    <div key={msg.id} className={cn('flex items-end gap-2', isCurrentUser ? 'justify-end' : 'justify-start')}>
                      {!isCurrentUser && (
                        <Avatar className="h-7 w-7 shrink-0 border border-border">
                          {msg.isModerator ? (
                            <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">MOD</AvatarFallback>
                          ) : (
                            <>
                              <AvatarImage src={opponentPhoto} />
                              <AvatarFallback className="text-[10px]">{opponentUsername?.substring(0, 2)}</AvatarFallback>
                            </>
                          )}
                        </Avatar>
                      )}

                      <div
                        className={cn(
                          'max-w-[80%] rounded-2xl p-3 text-xs sm:text-sm flex flex-col gap-1 shadow-2xs',
                          isCurrentUser && !msg.isModerator && 'bg-primary text-primary-foreground rounded-br-xs',
                          !isCurrentUser && !msg.isModerator && 'bg-muted text-foreground rounded-bl-xs',
                          msg.isModerator && 'bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200'
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-bold text-[11px] opacity-90">{senderDisplayName}</p>
                          {isModeratorOnly && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-sm bg-destructive/10 text-destructive border border-destructive/20">
                              <Lock className="h-2.5 w-2.5" /> Moderator Only
                            </span>
                          )}
                        </div>

                        {msg.message && <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>}

                        {/* Media attachments */}
                        {msg.mediaUrl && (
                          <div className="mt-1">
                            {isModeratorOnly && !canViewModeratorFile ? (
                              <div className="p-2.5 rounded-lg bg-background/50 border border-border/60 text-xs flex items-center gap-2 text-muted-foreground">
                                <Lock className="h-4 w-4 text-destructive" />
                                <span>Private evidence submitted to Moderator</span>
                              </div>
                            ) : msg.mediaType === 'image' ? (
                              <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="block mt-1">
                                <Image
                                  src={msg.mediaUrl}
                                  alt="Trade Media"
                                  width={240}
                                  height={240}
                                  className="rounded-lg object-cover max-h-56 w-auto border border-border/40"
                                />
                              </a>
                            ) : msg.mediaType === 'video' ? (
                              <div className="mt-1">
                                <video controls className="max-h-56 rounded-lg w-full" src={msg.mediaUrl} />
                              </div>
                            ) : (
                              <a
                                href={msg.mediaUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 p-2 rounded-lg bg-background/40 hover:bg-background/80 border text-xs font-semibold underline mt-1"
                              >
                                <FileText className="h-4 w-4" />
                                View Attached Document
                              </a>
                            )}
                          </div>
                        )}

                        <p className="text-[10px] font-mono opacity-70 text-right w-full mt-0.5">
                          {toDate(msg.createdAt)?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>

      <CardFooter className="border-t border-border/60 p-3">
        <form onSubmit={handleSendMessage} className="flex w-full items-center space-x-2">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileSelect}
            accept="image/*,video/*,application/pdf,.doc,.docx"
          />
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </Button>
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Write a message in escrow room..."
            autoComplete="off"
            disabled={isUploading}
            className="text-xs sm:text-sm"
          />
          <Button type="submit" size="icon" disabled={isUploading || !newMessage.trim()} className="shrink-0 font-bold">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardFooter>

      {/* Dispute Media Privacy Selection Modal */}
      <Dialog open={isPrivacyModalOpen} onOpenChange={setIsPrivacyModalOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-bold">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Dispute Evidence Privacy
            </DialogTitle>
            <DialogDescription className="text-xs">
              This trade is currently in dispute. Who should be allowed to view this attachment?
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            value={disputeVisibility}
            onValueChange={(val: any) => setDisputeVisibility(val)}
            className="space-y-2.5 py-2"
          >
            <div className="flex items-center space-x-3 p-3 rounded-xl border border-border bg-muted/20 cursor-pointer">
              <RadioGroupItem value="all" id="opt-all" />
              <Label htmlFor="opt-all" className="cursor-pointer text-xs font-semibold">
                <div className="text-foreground">Moderator and Counterparty</div>
                <div className="text-[11px] text-muted-foreground font-normal">
                  Visible to both you, your trading partner, and the Pax escrow mediator.
                </div>
              </Label>
            </div>

            <div className="flex items-center space-x-3 p-3 rounded-xl border border-destructive/30 bg-destructive/5 cursor-pointer">
              <RadioGroupItem value="moderator_only" id="opt-mod" />
              <Label htmlFor="opt-mod" className="cursor-pointer text-xs font-semibold">
                <div className="text-destructive flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" /> Only Moderator (Private Evidence)
                </div>
                <div className="text-[11px] text-muted-foreground font-normal">
                  Your counterparty cannot view or open this file. Only the mediator can review it.
                </div>
              </Label>
            </div>
          </RadioGroup>

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsPrivacyModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (pendingUploadFile) {
                  processAndUploadFile(pendingUploadFile, disputeVisibility);
                }
              }}
              disabled={isUploading}
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Upload to Backblaze B2
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export { TradeChat as TradeChatSupabase };
export default TradeChat;
