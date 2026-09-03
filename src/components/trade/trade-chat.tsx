'use client';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';

import { useToast } from '@/hooks/use-toast';
import { useStopwatch } from '@/hooks/use-stopwatch';

import { cn, toDate } from '@/lib/utils';
import type { Trade, User, TradeChatMessage } from '@/lib/types';
import {
  sendTradeMessage,
  getTradeMessages,
  subscribeToTradeMessages,
  type TradeMessageRecord,
} from '@/lib/supabase/chat';

import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';

import { DefaultAvatar } from '@/components/icons';
import { Logo } from '@/components/logo';
import { FlagIcon } from '@/components/ui/flag-icon';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Clock, Send, Plus, Info as InfoIcon, Loader2, ThumbsUp, ThumbsDown, ShieldAlert } from 'lucide-react';
import { completeEscrow } from '@/lib/wallet';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/components/providers/auth-provider';
import { formatCompactUtc } from '@/lib/date-utils';

// --- Sub-component: TradeInstructions ---
function TradeInstructions({ trade, isBuyer }: { trade: Trade; isBuyer: boolean }) {
  const title = isBuyer
    ? `You're buying ${trade.amount.toFixed(8)} ${trade.crypto} for ${trade.fiatAmount.toLocaleString()} ${trade.fiatCurrency}.`
    : `You're selling ${trade.amount.toFixed(8)} ${trade.crypto} for ${trade.fiatAmount.toLocaleString()} ${trade.fiatCurrency}.`;

  const subtitle = 'The crypto is now in escrow.';

  const buyerInstructions = [
    'Wait for the seller to provide their payment details in the chat.',
    'Make your payment using the details provided.',
    "Mark the trade as 'Paid' and upload proof of payment if necessary.",
    'Wait for your trade partner to confirm they have received your payment.',
    'Your trade partner will release the crypto to you.',
  ];
  const sellerInstructions = [
    'Share your payment details with the buyer in the chat.',
    'Wait for the buyer to make the payment.',
    'Once payment is received and confirmed in your account, release the crypto.',
    'Do not release funds based on payment proof alone. Always verify in your account.',
    "If the buyer doesn't pay within the time limit, the trade will automatically expire.",
  ];

  const instructions = isBuyer ? buyerInstructions : sellerInstructions;

  return (
    <Alert className="bg-amber-100 border-amber-200 text-amber-900 dark:bg-amber-950/60 dark:border-amber-800/50 dark:text-amber-200">
      <InfoIcon className="h-4 w-4 text-amber-700 dark:text-amber-300" />
      <AlertTitle className="font-bold text-amber-900 dark:text-amber-100">{title}</AlertTitle>
      <AlertDescription className="text-amber-800 dark:text-amber-200/90">
        <p>{subtitle}</p>
        <ol className="list-decimal list-inside space-y-1 text-xs mt-2">
          {instructions.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </AlertDescription>
    </Alert>
  );
}

// --- Sub-component: SystemMessage ---
function SystemMessage({
  title,
  children,
  timestamp,
  variant,
}: {
  title: string;
  children: React.ReactNode;
  timestamp: string;
  variant?: 'default' | 'destructive' | 'success' | 'warning';
}) {
  const timeString = timestamp ? formatCompactUtc(timestamp) : '';

  const variants = {
    default:
      'bg-blue-100 border-blue-200 text-blue-900 dark:bg-blue-950/60 dark:border-blue-800/50 dark:text-blue-200',
    destructive:
      'bg-red-100 border-red-200 text-red-900 dark:bg-red-950/60 dark:border-red-800/50 dark:text-red-200',
    success:
      'bg-green-100 border-green-200 text-green-900 dark:bg-green-950/60 dark:border-green-800/50 dark:text-green-200',
    warning:
      'bg-gray-100 border-gray-200 text-gray-900 dark:bg-gray-800/60 dark:border-gray-700/50 dark:text-gray-200',
  };

  return (
    <div className={cn('text-center text-xs p-3 rounded-md border', variants[variant || 'default'])}>
      <p className="font-bold mb-1">{title}</p>
      <div className="text-left text-xs whitespace-pre-wrap">{children}</div>
      <p className="text-right text-xs opacity-70 mt-2">{timeString}</p>
    </div>
  );
}

// --- Sub-component: TradeSummaryBar ---
const TradeSummaryBar = ({ trade, currentUserRole }: { trade: Trade; currentUserRole: 'buy' | 'sell' }) => {
  const isBuyer = currentUserRole === 'buy';
  const bgColor = isBuyer ? 'bg-green-600' : 'bg-destructive';
  const textColor = 'text-destructive-foreground';
  const roleText = isBuyer ? 'Buying' : 'Selling';

  return (
    <div className={cn('p-4 rounded-lg text-base font-semibold text-center', bgColor, textColor)}>
      {roleText} {trade.amount.toFixed(8)} {trade.crypto} for {trade.fiatAmount.toLocaleString()}{' '}
      {trade.fiatCurrency}
    </div>
  );
};

export function TradeChat({
  currentUserId,
  trade,
  opponent,
  isAdmin,
  sellerTerms,
  onInfoClick,
}: {
  currentUserId: string;
  trade: Trade;
  opponent: User | null | undefined;
  isAdmin: boolean;
  sellerTerms?: string;
  onInfoClick: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<TradeChatMessage[]>([]);
  const [areMessagesLoading, setAreMessagesLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isTradeStopped = ['released', 'cancelled', 'expired'].includes(trade.status);
  const stopwatch = useStopwatch(trade.createdAt, isTradeStopped);

  const mapSupabaseToChatMessage = useCallback(
    (rec: TradeMessageRecord): TradeChatMessage => {
      const isCurrentUser = rec.sender_id === currentUserId;
      const isModOrSystem =
        rec.sender_id === '00000000-0000-0000-0000-000000000000' ||
        rec.sender_id === 'system' ||
        rec.message?.includes('Moderator') ||
        rec.message?.startsWith('[MODERATOR]') ||
        rec.message?.startsWith('🛡️') ||
        rec.message?.startsWith('Paxones Moderator');

      let cleanMessage = rec.message || '';
      if (cleanMessage.includes('Moderator Joined') || cleanMessage.includes('joined the trade discussion')) {
        cleanMessage = 'Paxones Moderator joined the trade.';
      } else {
        cleanMessage = cleanMessage.replace(/^\[MODERATOR\s*(?:-\s*[^\]]+)?\]:\s*/i, '');
        cleanMessage = cleanMessage.replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/gi, '[protected]');
      }

      return {
        id: rec.id,
        tradeId: rec.trade_id,
        senderId: isModOrSystem ? '00000000-0000-0000-0000-000000000000' : rec.sender_id,
        senderUsername: isModOrSystem ? 'Paxones Moderator' : (isCurrentUser ? user?.displayName || 'You' : opponent?.userId || 'User'),
        message: cleanMessage,
        mediaUrl: rec.attachment_url || undefined,
        mediaType: rec.attachment_url ? 'image' : 'none',
        isModerator: isModOrSystem,
        createdAt: rec.created_at,
      };
    },
    [currentUserId, user?.displayName, opponent?.userId]
  );

  useEffect(() => {
    let isMounted = true;
    setAreMessagesLoading(true);

    const loadMessages = async () => {
      try {
        const { data: sbMessages } = await getTradeMessages(trade.id);
        if (isMounted && sbMessages) {
          const mapped = sbMessages.map(mapSupabaseToChatMessage);
          setMessages(mapped);
        }
      } catch (err) {
        console.error('Error fetching trade messages:', err);
      } finally {
        if (isMounted) setAreMessagesLoading(false);
      }
    };

    loadMessages();

    const unsubscribe = subscribeToTradeMessages(trade.id, (newRecord) => {
      if (!isMounted) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === newRecord.id)) return prev;
        const newMsg = mapSupabaseToChatMessage(newRecord);
        return [...prev, newMsg];
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [trade.id, mapSupabaseToChatMessage]);

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
    if (trade.status === 'released' && !trade.claimedByBuyer && currentUserId === trade.buyerId) {
      const claim = async () => {
        try {
          await completeEscrow(trade.id);
          toast({ title: 'Funds Claimed', description: `The ${trade.crypto} has been added to your wallet.` });
        } catch (error: any) {
          console.error('Auto-claiming funds failed:', error);
          toast({ variant: 'destructive', title: 'Claim Failed', description: error.message });
        }
      };
      claim();
    }
  }, [trade, currentUserId, toast]);

  const handleSendMessage = async (e: React.FormEvent, mediaUrl?: string, _mediaType?: 'image' | 'video' | 'audio') => {
    e.preventDefault();
    if ((!newMessage.trim() && !mediaUrl) || !user) return;
    const blockedWords = ['telegram', 'whatsapp', 'phone', 'contact'];
    if (blockedWords.some((word) => newMessage.toLowerCase().includes(word))) {
      toast({
        variant: 'destructive',
        title: 'Message Blocked',
        description: 'Please do not share contact information.',
      });
      return;
    }
    const messageToSend = newMessage;
    setNewMessage('');
    try {
      const { data: sbRecord, error: sbError } = await sendTradeMessage(
        trade.id,
        currentUserId,
        messageToSend,
        mediaUrl || null
      );

      if (sbError) throw sbError;

      if (sbRecord) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === sbRecord.id)) return prev;
          const newChatMsg = mapSupabaseToChatMessage(sbRecord);
          return [...prev, newChatMsg];
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Send Failed',
        description: error.message || 'Could not send message.',
      });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        let mediaType: 'image' | 'video' | 'audio' = 'image';
        if (file.type.startsWith('video/')) mediaType = 'video';
        if (file.type.startsWith('audio/')) mediaType = 'audio';
        handleSendMessage(new Event('submit'), result, mediaType).finally(() => {
          setIsUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        });
      } else {
        setIsUploading(false);
      }
    };
    reader.onerror = () => {
      setIsUploading(false);
      toast({
        variant: 'destructive',
        title: 'File Read Error',
        description: 'Could not read the selected file.',
      });
    };
    reader.readAsDataURL(file);
  };

  const isBuyer = currentUserId === trade.buyerId;

  const opponentLastActive = opponent?.lastActive ? toDate(opponent.lastActive) : null;
  let activity = { text: 'Offline', dotClass: 'bg-gray-500', textClass: 'text-muted-foreground' };

  if (opponentLastActive) {
    const diffMinutes = (new Date().getTime() - opponentLastActive.getTime()) / (1000 * 60);
    const formattedDistance = formatDistanceToNow(opponentLastActive);

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

  return (
    <Card className="flex flex-col h-full shadow-none border-0 rounded-none">
      <CardHeader className="space-y-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Link href={`/users/${opponent?.userId || ''}`}>
              <Avatar className="h-10 w-10">
                <AvatarImage src={opponent?.photoURL} />
                <AvatarFallback>
                  <DefaultAvatar />
                </AvatarFallback>
              </Avatar>
            </Link>
            <div>
              <div className="flex items-center gap-1.5">
                <Link href={`/users/${opponent?.userId || ''}`} className="font-semibold hover:underline">
                  {opponent?.userId}
                </Link>
                {opponent?.country && <FlagIcon countryCode={opponent.country} />}
                <Button variant="ghost" size="icon" onClick={onInfoClick} className="h-6 w-6">
                  <InfoIcon className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className={cn('h-2 w-2 rounded-full', activity.dotClass)} />
                <p className={cn('text-xs', activity.textClass)}>{activity.text}</p>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <ThumbsUp className="h-4 w-4 text-green-500" />
                <span>{opponent?.positiveFeedback || 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ThumbsDown className="h-4 w-4 text-red-500" />
                <span>{opponent?.negativeFeedback || 0}</span>
              </div>
            </div>
            <div className="text-sm font-semibold font-mono flex items-center gap-1.5 justify-end mt-1">
              <Clock className="h-4 w-4" />
              {stopwatch}
            </div>
          </div>
        </div>
        <TradeSummaryBar trade={trade} currentUserRole={isBuyer ? 'buy' : 'sell'} />
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-6 pt-0 min-h-0">
        <ScrollArea className="h-full pr-4" ref={scrollAreaRef}>
          <div className="space-y-4">
            <TradeInstructions trade={trade} isBuyer={isBuyer} />
            {sellerTerms && (
              <SystemMessage title="Seller's Terms & Conditions" timestamp={trade.createdAt}>
                <p className="whitespace-pre-wrap">{sellerTerms}</p>
              </SystemMessage>
            )}
            {areMessagesLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-16" />
                <Skeleton className="h-12" />
              </div>
            ) : (
              <div className="space-y-4">
                {displayMessages.map((msg) => {
                  if (msg.senderId === 'system') {
                    if (msg.message.includes('disputed')) {
                      return (
                        <SystemMessage
                          key={msg.id}
                          title="Trade is disputed. A moderator will join the chat shortly."
                          timestamp={msg.createdAt}
                          variant="destructive"
                        >
                          {msg.message}
                        </SystemMessage>
                      );
                    }
                    if (msg.message.includes('The trade is complete')) {
                      return (
                        <SystemMessage
                          key={msg.id}
                          title="Trade Completed"
                          timestamp={msg.createdAt}
                          variant="success"
                        >
                          <p>{msg.message}</p>
                        </SystemMessage>
                      );
                    }
                    if (msg.message.toLowerCase().includes('cancelled') || msg.message.toLowerCase().includes('expired')) {
                      return (
                        <SystemMessage
                          key={msg.id}
                          title="Trade Cancelled"
                          timestamp={msg.createdAt}
                          variant="destructive"
                        >
                          {msg.message}
                        </SystemMessage>
                      );
                    }
                    if (msg.message.includes('Buyer has marked the trade as Paid')) {
                      return (
                        <SystemMessage
                          key={msg.id}
                          title="Buyer has marked the trade as Paid."
                          timestamp={msg.createdAt}
                          variant="success"
                        >
                          {msg.message}
                        </SystemMessage>
                      );
                    }
                    if (msg.message.includes('Dispute resolved')) {
                      return (
                        <SystemMessage
                          key={msg.id}
                          title="Dispute Resolved"
                          timestamp={msg.createdAt}
                          variant="default"
                        >
                          {msg.message}
                        </SystemMessage>
                      );
                    }
                    return (
                      <SystemMessage key={msg.id} title="System Message" timestamp={msg.createdAt}>
                        {msg.message}
                      </SystemMessage>
                    );
                  }

                  const isCurrentUser = msg.senderId === currentUserId;
                  const senderName = isCurrentUser ? 'You' : opponent?.userId || 'User';

                  const senderAvatar = isCurrentUser ? null : msg.isModerator ? (
                    <Avatar className="h-8 w-8 border border-blue-500/40">
                      <AvatarFallback className="bg-blue-600 text-white flex items-center justify-center">
                        <ShieldAlert className="w-4 h-4 text-white" />
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={opponent?.photoURL} />
                      <AvatarFallback>{opponent?.userId?.substring(0, 2)}</AvatarFallback>
                    </Avatar>
                  );

                  return (
                    <div
                      key={msg.id}
                      className={cn('flex items-end gap-2', isCurrentUser ? 'justify-end' : 'justify-start')}
                    >
                      {!isCurrentUser && <div className="self-end">{senderAvatar}</div>}
                      <div
                        className={cn(
                          'max-w-[75%] rounded-lg p-3 text-sm flex flex-col items-start gap-1',
                          isCurrentUser && !msg.isModerator && 'bg-primary text-primary-foreground',
                          !isCurrentUser && !msg.isModerator && 'bg-muted',
                          msg.isModerator &&
                            'bg-blue-50 border border-blue-200 text-blue-950 dark:bg-blue-950/70 dark:border-blue-800 dark:text-blue-100 shadow-sm'
                        )}
                      >
                        {msg.isModerator ? (
                          <div className="flex items-center gap-1.5 font-bold text-xs text-blue-700 dark:text-blue-300 pb-0.5">
                            <div className="w-4 h-4 rounded bg-blue-600 flex items-center justify-center shrink-0">
                              <ShieldAlert className="w-2.5 h-2.5 text-white" />
                            </div>
                            <span>Paxones Moderator</span>
                          </div>
                        ) : (
                          <p className="font-bold text-xs">{senderName}</p>
                        )}
                        {msg.message && <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>}
                        {msg.mediaUrl && msg.mediaType === 'image' && (
                          <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer">
                            <Image
                              src={msg.mediaUrl}
                              alt="Uploaded attachment"
                              width={200}
                              height={200}
                              className="rounded-md mt-2 max-w-full h-auto"
                            />
                          </a>
                        )}
                        {msg.mediaUrl &&
                          (msg.mediaType === 'video' ||
                            msg.mediaType === 'audio' ||
                            msg.mediaType === undefined) && (
                            <a
                              href={msg.mediaUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary underline"
                            >
                              View Attached File
                            </a>
                          )}
                        <p className="text-xs mt-1 opacity-70 text-right w-full">
                          {msg.createdAt ? formatCompactUtc(msg.createdAt) : 'sending...'}
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
      <CardFooter>
        <form onSubmit={handleSendMessage} className="flex w-full items-center space-x-2">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileChange}
            accept="image/*,video/*,application/pdf"
          />
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
          </Button>
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Write a message..."
            autoComplete="off"
            disabled={isUploading}
          />
          <Button type="submit" size="icon" disabled={isUploading || !newMessage.trim()}>
            <Send className="h-5 w-5" />
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
