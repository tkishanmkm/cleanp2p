"use client";

import { useEffect, useState, useMemo } from 'react';

const useCountdown = (targetDate: string | number | Date) => {
    const [now, setNow] = useState(new Date().getTime());

    const targetTime = useMemo(() => {
        const time = new Date(targetDate).getTime();
        return isNaN(time) ? 0 : time;
    }, [targetDate]);

    useEffect(() => {
        if (targetTime <= 0) {
            // If the target is in the past or invalid, no need for an interval.
            // Update 'now' once to ensure the countdown reflects being finished.
            setNow(new Date().getTime());
            return;
        }
        
        const interval = setInterval(() => {
            setNow(new Date().getTime());
        }, 1000);

        return () => clearInterval(interval);
    }, [targetTime]);

    const countDown = Math.max(0, targetTime - now);
    const isFinished = targetTime <= 0 || countDown <= 0;
    
    const hours = Math.floor((countDown / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((countDown / 1000 / 60) % 60);
    const seconds = Math.floor((countDown / 1000) % 60);

    return { hours, minutes, seconds, isFinished };
};

export { useCountdown };
