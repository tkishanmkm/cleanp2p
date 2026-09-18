"use client";

import { useEffect, useState, useMemo } from 'react';

const useCountdown = (targetDate: string | number | Date) => {
    const targetTime = useMemo(() => {
        if (!targetDate) return 0;
        if (typeof targetDate === 'number') return isNaN(targetDate) ? 0 : targetDate;
        const time = targetDate instanceof Date ? targetDate.getTime() : new Date(targetDate).getTime();
        return isNaN(time) ? 0 : time;
    }, [typeof targetDate === 'object' && targetDate instanceof Date ? targetDate.getTime() : targetDate]);

    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (targetTime <= 0) {
            return;
        }

        setNow(Date.now());
        const interval = setInterval(() => {
            setNow(Date.now());
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
