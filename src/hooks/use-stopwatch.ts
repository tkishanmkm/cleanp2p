"use client";

import { useState, useEffect } from 'react';

export const formatTime = (timeInSeconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(timeInSeconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const useStopwatch = (
  startTime?: string | number | Date | null,
  isStopped: boolean = false,
  endTime?: string | number | Date | null
) => {
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() => {
    if (!startTime) return 0;
    const startMs = new Date(startTime).getTime();
    if (isNaN(startMs)) return 0;

    if (isStopped && endTime) {
      const endMs = new Date(endTime).getTime();
      if (!isNaN(endMs) && endMs >= startMs) {
        return Math.floor((endMs - startMs) / 1000);
      }
    }
    const nowMs = Date.now();
    return Math.max(0, Math.floor((nowMs - startMs) / 1000));
  });

  useEffect(() => {
    if (!startTime) {
      setElapsedSeconds(0);
      return;
    }

    const startMs = new Date(startTime).getTime();
    if (isNaN(startMs)) {
      setElapsedSeconds(0);
      return;
    }

    if (isStopped) {
      // Trade finished / cancelled / expired: calculate exact frozen duration
      const endMs = endTime ? new Date(endTime).getTime() : Date.now();
      const finalSec = !isNaN(endMs) && endMs >= startMs
        ? Math.floor((endMs - startMs) / 1000)
        : Math.max(0, Math.floor((Date.now() - startMs) / 1000));
      setElapsedSeconds(finalSec);
      return;
    }

    // Active trade: run stopwatch interval
    const updateElapsed = () => {
      const now = Date.now();
      const seconds = Math.max(0, Math.floor((now - startMs) / 1000));
      setElapsedSeconds(seconds);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startTime, isStopped, endTime]);

  return formatTime(elapsedSeconds);
};

export default useStopwatch;
