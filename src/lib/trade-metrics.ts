import { createClient } from '@/lib/supabase/client';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface UserTradeMetrics {
  avgPayTimeSeconds: number | null;
  avgReleaseTimeSeconds: number | null;
  avgPayTimeFormatted: string;
  avgReleaseTimeFormatted: string;
  completedBuyerTrades: number;
  completedSellerTrades: number;
}

export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds) || seconds <= 0) {
    return 'N/A';
  }
  if (seconds < 60) {
    return `${Math.max(1, Math.round(seconds))}s`;
  }
  const mins = Math.round(seconds / 60);
  if (mins < 60) {
    return `${mins} min${mins > 1 ? 's' : ''}`;
  }
  const hours = (seconds / 3600).toFixed(1);
  return `${hours} hr${Number(hours) > 1 ? 's' : ''}`;
}

/**
 * Calculate dynamic PostgreSQL aggregations for average pay and release times
 * for a specific user based on historical trade completion timestamps.
 *
 * Buyer Avg Pay Time: AVG(marked_paid_at - created_at)
 * Seller Avg Release Time: AVG(released_at - marked_paid_at)
 */
export async function calculateUserTradeMetrics(
  supabaseClient: SupabaseClient,
  userId: string
): Promise<UserTradeMetrics> {
  if (!userId) {
    return {
      avgPayTimeSeconds: null,
      avgReleaseTimeSeconds: null,
      avgPayTimeFormatted: 'N/A',
      avgReleaseTimeFormatted: 'N/A',
      completedBuyerTrades: 0,
      completedSellerTrades: 0,
    };
  }

  try {
    // 1. Fetch buyer trades that were paid
    const { data: buyerTrades } = await supabaseClient
      .from('trades')
      .select('created_at, paid_at, marked_paid_at, status')
      .eq('buyer_id', userId)
      .in('status', ['paid', 'completed', 'released', 'payment_sent']);

    let buyerTimeSum = 0;
    let validBuyerTrades = 0;

    if (buyerTrades && buyerTrades.length > 0) {
      for (const t of buyerTrades) {
        const paidTimeStr = t.marked_paid_at || t.paid_at;
        const createdTimeStr = t.created_at;

        if (paidTimeStr && createdTimeStr) {
          const paidTime = new Date(paidTimeStr).getTime();
          const createdTime = new Date(createdTimeStr).getTime();
          const diffSeconds = (paidTime - createdTime) / 1000;

          // Only consider valid durations (between 5 seconds and 24 hours)
          if (diffSeconds >= 2 && diffSeconds <= 86400) {
            buyerTimeSum += diffSeconds;
            validBuyerTrades++;
          }
        }
      }
    }

    const avgPaySeconds = validBuyerTrades > 0 ? Math.round(buyerTimeSum / validBuyerTrades) : null;

    // 2. Fetch seller trades that were released/completed
    const { data: sellerTrades } = await supabaseClient
      .from('trades')
      .select('paid_at, marked_paid_at, released_at, completed_at, status')
      .eq('seller_id', userId)
      .in('status', ['completed', 'released']);

    let sellerTimeSum = 0;
    let validSellerTrades = 0;

    if (sellerTrades && sellerTrades.length > 0) {
      for (const t of sellerTrades) {
        const paidTimeStr = t.marked_paid_at || t.paid_at;
        const releaseTimeStr = t.released_at || t.completed_at;

        if (paidTimeStr && releaseTimeStr) {
          const paidTime = new Date(paidTimeStr).getTime();
          const releaseTime = new Date(releaseTimeStr).getTime();
          const diffSeconds = (releaseTime - paidTime) / 1000;

          // Only consider valid durations (between 2 seconds and 48 hours)
          if (diffSeconds >= 2 && diffSeconds <= 172800) {
            sellerTimeSum += diffSeconds;
            validSellerTrades++;
          }
        }
      }
    }

    const avgReleaseSeconds = validSellerTrades > 0 ? Math.round(sellerTimeSum / validSellerTrades) : null;

    const metrics: UserTradeMetrics = {
      avgPayTimeSeconds: avgPaySeconds,
      avgReleaseTimeSeconds: avgReleaseSeconds,
      avgPayTimeFormatted: formatDurationSeconds(avgPaySeconds),
      avgReleaseTimeFormatted: formatDurationSeconds(avgReleaseSeconds),
      completedBuyerTrades: validBuyerTrades,
      completedSellerTrades: validSellerTrades,
    };

    // Update profiles table with calculated metrics
    const updatePayload: Record<string, any> = {
      avg_pay_time_seconds: avgPaySeconds,
      avg_release_time_seconds: avgReleaseSeconds,
      avg_pay_time: metrics.avgPayTimeFormatted,
      avg_release_time: metrics.avgReleaseTimeFormatted,
      avg_payment_minutes: avgPaySeconds ? Math.ceil(avgPaySeconds / 60) : null,
      avg_release_minutes: avgReleaseSeconds ? Math.ceil(avgReleaseSeconds / 60) : null,
    };

    await supabaseClient
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId);

    return metrics;
  } catch (err) {
    console.warn('Error calculating user trade metrics:', err);
    return {
      avgPayTimeSeconds: null,
      avgReleaseTimeSeconds: null,
      avgPayTimeFormatted: 'N/A',
      avgReleaseTimeFormatted: 'N/A',
      completedBuyerTrades: 0,
      completedSellerTrades: 0,
    };
  }
}
