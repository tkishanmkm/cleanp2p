'use client';

import { useState, useEffect } from 'react';

interface TradeChatTimerProps {
  createdAt: string;
  status: 'PENDING' | 'ESCROW_LOCKED' | 'COMPLETED' | 'CANCELLED' | string;
  durationSeconds?: number | null;
  paymentWindowMinutes?: number; // e.g. 30
}

export default function TradeChatTimer({
  createdAt,
  status,
  durationSeconds,
  paymentWindowMinutes = 30,
}: TradeChatTimerProps) {
  const [elapsed, setElapsed] = useState<number>(0);
  const [remaining, setRemaining] = useState<number>((paymentWindowMinutes || 30) * 60);

  const normalizedStatus = (status || '').toUpperCase();
  const isTradeStopped = 
    normalizedStatus === 'COMPLETED' || 
    normalizedStatus === 'CANCELLED' || 
    normalizedStatus === 'RELEASED' || 
    normalizedStatus === 'EXPIRED' ||
    normalizedStatus === 'RESOLVED';

  useEffect(() => {
    // 1. If trade is COMPLETED, CANCELLED, or in any terminal state, freeze timer permanently
    if (isTradeStopped) {
      if (durationSeconds != null && durationSeconds > 0) {
        setElapsed(durationSeconds);
      } else {
        const startTime = new Date(createdAt || Date.now()).getTime();
        const fallbackDuration = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
        setElapsed(fallbackDuration);
      }
      setRemaining(0);
      return;
    }

    // 2. Continuous counting for active trade
    const startTime = new Date(createdAt || Date.now()).getTime();
    const windowMinutes = paymentWindowMinutes || 30;
    const windowMs = windowMinutes * 60 * 1000;

    const updateTimers = () => {
      const now = Date.now();
      const currentElapsedSeconds = Math.max(0, Math.floor((now - startTime) / 1000));
      const currentRemainingMs = Math.max(0, startTime + windowMs - now);

      setElapsed(currentElapsedSeconds);
      setRemaining(Math.floor(currentRemainingMs / 1000));
    };

    updateTimers();
    const interval = setInterval(updateTimers, 1000);

    return () => clearInterval(interval);
  }, [createdAt, status, isTradeStopped, durationSeconds, paymentWindowMinutes]);

  const formatHMS = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatMS = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center gap-2.5 sm:gap-3.5 bg-background/95 dark:bg-slate-900/95 text-foreground px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl shadow-xs border border-border/80 dark:border-slate-800">
      {/* 1. Reverse Countdown Timer */}
      {!isTradeStopped && (
        <div className="flex flex-col border-r border-border/80 dark:border-slate-700/80 pr-2.5 sm:pr-3.5">
          <span className="text-[10px] sm:text-xs text-muted-foreground font-medium leading-tight">Payment Window</span>
          <span className={`text-xs sm:text-sm font-bold font-mono tabular-nums leading-tight ${remaining < 300 ? 'text-destructive animate-pulse' : 'text-amber-600 dark:text-amber-400'}`}>
            {formatMS(remaining)}
          </span>
        </div>
      )}

      {/* 2. Straight Stopwatch Count-up */}
      <div className="flex flex-col">
        <span className="text-[10px] sm:text-xs text-muted-foreground font-medium leading-tight">
          {isTradeStopped ? 'Total Trade Time' : 'Elapsed Time'}
        </span>
        <span className="text-xs sm:text-sm font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 leading-tight">
          {formatHMS(elapsed)}
        </span>
      </div>
    </div>
  );
}

export { TradeChatTimer };
