'use client';

import { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toDate } from '@/lib/utils';
import type { Feedback } from '@/lib/types';
import { FlagIcon } from '../ui/flag-icon';
import { supabase } from '@/lib/supabase/client';

export function FeedbackCard({ feedback }: { feedback: Feedback }) {
  const [country, setCountry] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!feedback.fromUser) return;
    let isMounted = true;

    async function fetchCountry() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('country')
          .eq('id', feedback.fromUser)
          .single();

        if (!error && data && isMounted) {
          setCountry(data.country);
        }
      } catch (err) {
        console.error('Error fetching country for feedback author:', err);
      }
    }

    fetchCountry();

    return () => {
      isMounted = false;
    };
  }, [feedback.fromUser]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm">{feedback.fromUsername}</p>
          {country && <FlagIcon countryCode={country} />}
        </div>
        <div className="flex items-center gap-1 text-sm">
          {feedback.rating === 'positive' ? (
            <ThumbsUp className="h-4 w-4 text-green-500" />
          ) : (
            <ThumbsDown className="h-4 w-4 text-red-500" />
          )}
          <span className={feedback.rating === 'positive' ? 'text-green-600 capitalize' : 'text-red-600 capitalize'}>
            {feedback.rating}
          </span>
        </div>
      </div>
      <p className="text-sm mb-2">{feedback.comment}</p>
      <div className="flex items-center justify-end text-xs text-muted-foreground">
        <span>{toDate(feedback.createdAt) ? formatDistanceToNow(toDate(feedback.createdAt)!) + ' ago' : ''}</span>
      </div>
    </div>
  );
}
