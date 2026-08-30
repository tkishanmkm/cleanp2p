
"use client";

import { useState, useEffect } from 'react';

const formatTime = (timeInSeconds: number) => {
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = timeInSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export const useStopwatch = (startTime: string | number | Date, isStopped: boolean = false) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (isStopped) {
      // If stopped, no need to run the interval
      return;
    }
    
    const startDate = new Date(startTime).getTime();
    if (isNaN(startDate)) {
      setElapsedSeconds(0);
      return;
    }

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const seconds = Math.floor((now - startDate) / 1000);
      setElapsedSeconds(seconds);
    }, 1000);

    // Initial calculation
    const now = new Date().getTime();
    const seconds = Math.floor((now - startDate) / 1000);
    setElapsedSeconds(seconds > 0 ? seconds : 0);

    return () => clearInterval(interval);
  }, [startTime, isStopped]);
  
   useEffect(() => {
    if (isStopped) {
       // When it stops, calculate the final duration from start to stop time.
       // The `trade.releasedAt` or similar would be the `stopTime`.
       // For now, we assume the last recorded `elapsedSeconds` is sufficient.
    }
   }, [isStopped]);

  return formatTime(elapsedSeconds);
};

