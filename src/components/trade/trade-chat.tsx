'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useStopwatch } from '@/hooks/use-stopwatch';
import { cn, toDate } from '@/lib/utils';
import type { Trade, User, TradeChatMessage } from '@/lib/types';

import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from "@/components/ui/skeleton";

import { DefaultAvatar } from '@/components/icons';
import { Logo } from '@/components/logo';
import { FlagIcon } from '@/components/ui/flag-icon';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Clock, Send, Plus, Info as InfoIcon, Loader2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

function TradeInstructions({ trade, isBuyer }: { trade: Trade, isBuyer: boolean }) {
    const title = isBuyer 
        ? `You're buying ${trade.amount.toFixed(8)} ${trade.crypto} for ${trade.fiatAmount.toLocaleString()} ${trade.fiatCurrency}.`
        : `You're selling ${trade.amount.toFixed(8)} ${trade.crypto} for ${trade.fiatAmount.toLocaleString()} ${trade.fiatCurrency}.`;
    
    const subtitle = "The crypto is now in escrow.";
    
    const buyerInstructions = [
        "Wait for the seller to provide their payment details in the chat.",
        "Make your payment using the details provided.",
        "Mark the trade as 'Paid' and upload proof of payment if necessary.",
        "Wait for your trade partner to confirm they have received your payment.",
        "Your trade partner will release the crypto to you.",
    ];
    const sellerInstructions = [
        "Share your payment details with the buyer in the chat.",
        "Wait for the buyer to make the payment.",
        "Once payment is received and confirmed in your account, release the crypto.",
        "Do not release funds based on payment proof alone. Always verify in your account.",
        "If the buyer doesn't pay within the time limit, the trade will automatically expire.",
    ];

    const instructions = isBuyer ? buyerInstructions : sellerInstructions;
    
    return (
        <Alert className="bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800/40 dark:text-amber-200">
            <InfoIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle className="font-bold text-amber-900 dark:text-amber-100 text-xs sm:text-sm">
                {title}
            </AlertTitle>
            <AlertDescription className="text-amber-800 dark:text-amber-200/90 text-xs">
                <p>{subtitle}</p>
                <ol className="list-decimal list-inside space-y-1 mt-2">
                    {instructions.map((step, i) => <li key={i}>{step}</li>)}
                </ol>
            </AlertDescription>
        </Alert>
    );
}

function SystemMessage({ title, children, timestamp, variant }: { title: string; children: React.ReactNode; timestamp: string, variant?: 'default' | 'destructive' | 'success' | 'warning' }) {
    const timeString = toDate(timestamp)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) || '';

    const variants = {
        default: "bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-800/40 dark:text-blue-200",
        destructive: "bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-800/40 dark:text-red-200",
        success: "bg-green-50 border-green-200 text-green-900 dark:bg-green-950/40 dark:border-green-800/40 dark:text-green-200",
        warning: "bg-secondary border-border text-secondary-foreground",
    };

    return (
        <div className={cn("text-center text-xs p-3 rounded-lg border my-2", variants[variant || 'default'])}>
            <p className="font-bold mb-1">{title}</p>
            <div className="text-left text-xs whitespace-pre-wrap">{children}</div>
            <p className="text-right text-[10px] opacity-70 mt-2">{timeString}</p>
        </div>
    );
}

const TradeSummaryBar = ({ trade, currentUserRole }: { trade: Trade, currentUserRole: 'buy' | 'sell' }) => {
    const isBuyer = currentUserRole === 'buy';
    const bgColor = isBuyer ? 'bg-emerald-600 dark:bg-emerald-700 text-white' : 'bg-destructive text-destructive-foreground';
    const roleText = isBuyer ? 'Buying' : 'Selling';
    
    return (
        <div className={cn('p-3 rounded-xl text-xs sm:text-sm font-semibold text-center shadow-sm', bgColor)}>
            {roleText} {trade.amount.toFixed(8)} {trade.crypto} for {trade.fiatAmount.toLocaleString()} {trade.fiatCurrency}
        </div>
    );
};

export function TradeChat({ currentUserId, trade, opponent, isAdmin, sellerTerms, onInfoClick }: { currentUserId: string; trade: Trade; opponent: User | null | undefined; isAdmin: boolean; sellerTerms?: string; onInfoClick: () => void; }) {
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<TradeChatMessage[]>([]);
  const [areMessagesLoading, setAreMessagesLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isTradeStopped = ['released', 'cancelled', 'expired'].includes(trade.status);
  const stopwatch = useStopwatch(trade.createdAt, isTradeStopped);

  useEffect(() => {
    const fetchMessages = async () => {
      setAreMessagesLoading(true);
      const { data, error } = await supabase
        .from('trade_messages')
        .select('*')
        .eq('trade_id', trade.id)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Failed to load chat messages:', error);
      } else if (data) {
        setMessages(
          data.map((m: any) => ({
            id: m.id,
            tradeId: m.trade_id || trade.id,
            senderId: m.sender_id || 'system',
            senderUsername: m.sender_username || 'User',
            message: m.message || '',
            mediaUrl: m.media_url || undefined,
            mediaType: m.media_type || 'none',
            isModerator: !!m.is_moderator,
            createdAt: m.created_at || new Date().toISOString(),
          }))
        );
      }
      setAreMessagesLoading(false);
    };

    fetchMessages();

    const channel = supabase
      .channel(`trade_messages:${trade.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trade_messages', filter: `trade_id=eq.${trade.id}` },
        (payload) => {
          const m = payload.new as any;
          const mappedMessage: TradeChatMessage = {
            id: m.id,
            tradeId: m.trade_id || trade.id,
            senderId: m.sender_id || 'system',
            senderUsername: m.sender_username || 'User',
            message: m.message || '',
            mediaUrl: m.media_url || undefined,
            mediaType: m.media_type || 'none',
            isModerator: !!m.is_moderator,
            createdAt: m.created_at || new Date().toISOString(),
          };
          setMessages((prev) => [...prev, mappedMessage]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [trade.id]);

  const displayMessages = useMemo(() => {
    if (!messages) return [];
    const allMessages = [...messages];
    allMessages.sort((a, b) => (toDate(a.createdAt)?.getTime() ?? 0) - (toDate(b.createdAt)?.getTime() ?? 0));
    return allMessages;
  }, [messages]);

  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) { viewport.scrollTop = viewport.scrollHeight; }
    }
  }, [displayMessages]);

  const handleSendMessage = async (e: React.FormEvent, mediaUrl?: string, mediaType?: 'image' | 'video' | 'audio') => {
    e.preventDefault();
    if ((!newMessage.trim() && !mediaUrl)) return;
    const blockedWords = ['telegram', 'whatsapp', 'phone', 'contact'];
    if (blockedWords.some(word => newMessage.toLowerCase().includes(word))) {
      toast({ variant: 'destructive', title: 'Message Blocked', description: 'Please do not share contact information.' });
      return;
    }
    const messageToSend = newMessage;
    setNewMessage('');
    try {
      const { error } = await supabase.from('trade_messages').insert({
        trade_id: trade.id,
        sender_id: currentUserId,
        sender_username: opponent?.userId || 'User',
        message: messageToSend,
        is_moderator: isAdmin,
        media_url: mediaUrl || null,
        media_type: mediaType || 'none',
      });

      if (error) {
        toast({ variant: 'destructive', title: 'Send Failed', description: error.message });
      } else if (mediaUrl && trade.status === 'active') {
        await supabase.from('trades').update({ payment_receipt_url: mediaUrl }).eq('id', trade.id);
        toast({ title: 'Receipt Uploaded', description: 'The seller has been notified.' });
      }
    } catch (error: any) { 
      toast({ variant: 'destructive', title: 'Send Failed', description: error.message }); 
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
        handleSendMessage(new Event('submit') as any, result, mediaType).finally(() => { 
          setIsUploading(false); 
          if (fileInputRef.current) fileInputRef.current.value = ""; 
        });
      } else { 
        setIsUploading(false); 
      }
    };
    reader.onerror = () => { 
      setIsUploading(false); 
      toast({ variant: 'destructive', title: 'File Read Error', description: 'Could not read the selected file.' }); 
    };
    reader.readAsDataURL(file);
  };

  const isBuyer = currentUserId === trade.buyerId;
  const opponentLastActive = opponent?.lastActive ? toDate(opponent.lastActive) : null;
  let activity = { text: 'Offline', dotClass: 'bg-zinc-400 dark:bg-zinc-600', textClass: 'text-muted-foreground' };

  if (opponentLastActive) {
    const diffMinutes = (new Date().getTime() - opponentLastActive.getTime()) / (1000 * 60);
    const formattedDistance = formatDistanceToNow(opponentLastActive);

    if (diffMinutes < 5) {
      activity = { text: 'Active now', dotClass: 'bg-emerald-500', textClass: 'text-emerald-600 dark:text-emerald-400' };
    } else if (diffMinutes < 60) {
      activity = { text: `${formattedDistance} ago`, dotClass: 'bg-emerald-500', textClass: 'text-emerald-600 dark:text-emerald-400' };
    } else if (diffMinutes < 24 * 60) {
      activity = { text: `${formattedDistance} ago`, dotClass: 'bg-amber-500', textClass: 'text-amber-600 dark:text-amber-400' };
    } else {
      activity = { text: `${formattedDistance} ago`, dotClass: 'bg-zinc-400 dark:bg-zinc-600', textClass: 'text-muted-foreground' };
    }
  }

  return (
    <Card className="flex flex-col h-full shadow-sm border bg-card text-card-foreground rounded-xl overflow-hidden">
      <CardHeader className="space-y-3 p-4 sm:p-6 border-b bg-muted/30">
        <div className="flex justify-between items-center gap-2">
            <div className="flex items-center gap-3 min-w-0">
                <Link href={`/users/${opponent?.userId || ''}`} className="shrink-0">
                    <Avatar className="h-10 w-10 border"><AvatarImage src={opponent?.photoURL} /><AvatarFallback><DefaultAvatar /></AvatarFallback></Avatar>
                </Link>
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        <Link href={`/users/${opponent?.userId || ''}`} className="font-semibold text-sm hover:underline truncate">{opponent?.userId}</Link>
                        {opponent?.country && <FlagIcon countryCode={opponent.country} />}
                        <Button variant="ghost" size="icon" onClick={onInfoClick} className="h-6 w-6 ml-1"><InfoIcon className="h-4 w-4" /></Button>
                    </div>
                     <div className="flex items-center gap-1.5 mt-0.5">
                        <div className={cn('h-2 w-2 rounded-full shrink-0', activity.dotClass)} />
                        <p className={cn("text-xs truncate", activity.textClass)}>
                            {activity.text}
                        </p>
                    </div>
                </div>
            </div>
            <div className="text-right shrink-0">
                <div className="flex items-center gap-3 text-xs justify-end">
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><ThumbsUp className="h-3.5 w-3.5" />{opponent?.positiveFeedback || 0}</span>
                    <span className="flex items-center gap-1 text-destructive"><ThumbsDown className="h-3.5 w-3.5" />{opponent?.negativeFeedback || 0}</span>
                </div>
                <div className="text-xs font-semibold font-mono flex items-center gap-1 justify-end mt-1 text-muted-foreground"><Clock className="h-3.5 w-3.5" />{stopwatch}</div>
            </div>
        </div>
        <TradeSummaryBar trade={trade} currentUserRole={isBuyer ? 'buy' : 'sell'} />
      </CardHeader>
      
      <CardContent className="flex-1 overflow-hidden p-3 sm:p-4 min-h-0 bg-background/50">
        <ScrollArea className="h-full pr-3" ref={scrollAreaRef}>
          <div className="space-y-3">
            <TradeInstructions trade={trade} isBuyer={isBuyer} />
            {sellerTerms && (
              <SystemMessage title="Seller's Terms & Conditions" timestamp={trade.createdAt} variant="warning">
                <p className="whitespace-pre-wrap">{sellerTerms}</p>
              </SystemMessage>
            )}
            {areMessagesLoading ? (
                <div className="space-y-3 py-4">
                    <Skeleton className="h-16 w-3/4 rounded-lg" />
                    <Skeleton className="h-12 w-1/2 ml-auto rounded-lg" />
                </div>
            ) : (
              <div className="space-y-3">
                {displayMessages.map((msg) => {
                  if (msg.senderId === 'system' || !msg.senderId) {
                    if (msg.message.includes("disputed")) {
                      return <SystemMessage key={msg.id} title="Trade is disputed. A moderator will join the chat shortly." timestamp={msg.createdAt} variant="destructive">{msg.message}</SystemMessage>;
                    }
                    if (msg.message.includes("The trade is complete")) {
                      return <SystemMessage key={msg.id} title="Trade Completed" timestamp={msg.createdAt} variant="success"><p>{msg.message}</p></SystemMessage>;
                    }
                    if (msg.message.toLowerCase().includes("cancelled") || msg.message.toLowerCase().includes("expired")) {
                      return <SystemMessage key={msg.id} title="Trade Cancelled" timestamp={msg.createdAt} variant="destructive">{msg.message}</SystemMessage>;
                    }
                    if (msg.message.includes("Buyer has marked the trade as Paid")) {
                      return <SystemMessage key={msg.id} title="Buyer has marked the trade as Paid." timestamp={msg.createdAt} variant="success">{msg.message}</SystemMessage>;
                    }
                    if (msg.message.includes("Dispute resolved")) {
                      return <SystemMessage key={msg.id} title="Dispute Resolved" timestamp={msg.createdAt} variant="default">{msg.message}</SystemMessage>;
                    }
                    return <SystemMessage key={msg.id} title="System Message" timestamp={msg.createdAt}>{msg.message}</SystemMessage>;
                  }

                  const isCurrentUser = msg.senderId === currentUserId;
                  let senderName: string | React.ReactNode = isCurrentUser ? 'You' : opponent?.userId || 'Opponent';
                  if (msg.isModerator) senderName = 'Moderator';
                  
                  const senderAvatar = isCurrentUser 
                    ? null 
                    : msg.isModerator 
                      ? <Avatar className="h-7 w-7 border"><AvatarFallback className="bg-transparent"><Logo /></AvatarFallback></Avatar> 
                      : <Avatar className="h-7 w-7 border"><AvatarImage src={opponent?.photoURL} /><AvatarFallback>{opponent?.userId?.substring(0, 2)}</AvatarFallback></Avatar>;

                  return (
                    <div key={msg.id} className={cn('flex items-end gap-2', isCurrentUser ? 'justify-end' : 'justify-start')}>
                      {!isCurrentUser && (<div className="self-end mb-1">{senderAvatar}</div>)}
                      <div className={cn(
                          'max-w-[80%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm flex flex-col items-start gap-1 shadow-sm',
                          isCurrentUser && !msg.isModerator && 'bg-primary text-primary-foreground rounded-br-none',
                          !isCurrentUser && !msg.isModerator && 'bg-muted text-muted-foreground rounded-bl-none',
                          msg.isModerator && 'bg-blue-50 border border-blue-200 text-blue-900 dark:bg-blue-950/50 dark:border-blue-800/50 dark:text-blue-200 w-full'
                      )}>
                        <p className={cn("font-bold text-[10px] opacity-80", isCurrentUser && !msg.isModerator && "text-primary-foreground/90")}>{senderName}</p>
                        {msg.message && <p className="whitespace-pre-wrap break-words w-full">{msg.message}</p>}
                        {msg.mediaUrl && msg.mediaType === 'image' && (
                            <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="mt-1 block">
                                <Image src={msg.mediaUrl} alt="Uploaded attachment" width={200} height={200} className="rounded-lg max-w-full h-auto border object-cover" />
                            </a>
                        )}
                        {msg.mediaUrl && (msg.mediaType === 'video' || msg.mediaType === 'audio' || msg.mediaType === undefined) && (
                            <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" className="text-current underline font-medium mt-1">View Attached File</a>
                        )}
                        <p className={cn("text-[10px] mt-1 opacity-70 text-right w-full", isCurrentUser && !msg.isModerator && "text-primary-foreground/70")}>
                            {toDate(msg.createdAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) ?? 'sending...'}
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

      <CardFooter className="p-3 sm:p-4 border-t bg-muted/20">
        <form onSubmit={handleSendMessage} className="flex w-full items-center gap-2">
            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileChange} accept="image/*,video/*,application/pdf" />
            <Button variant="outline" size="icon" type="button" onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="shrink-0 rounded-full h-9 w-9">
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
            <Input 
                value={newMessage} 
                onChange={(e) => setNewMessage(e.target.value)} 
                placeholder="Write a message..." 
                autoComplete="off" 
                disabled={isUploading} 
                className="flex-1 rounded-full text-xs sm:text-sm bg-background"
            />
            <Button type="submit" size="icon" disabled={isUploading || !newMessage.trim()} className="shrink-0 rounded-full h-9 w-9">
              <Send className="h-4 w-4" /><span className="sr-only">Send</span>
            </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
