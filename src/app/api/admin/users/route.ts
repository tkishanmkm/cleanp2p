import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();
    const { searchParams } = new URL(req.url);
    const query = (searchParams.get("q") || "").trim().toLowerCase();

    // 1. Fetch profiles
    const { data: profiles, error: profError } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (profError) {
      console.error("[API/ADMIN/USERS] Error fetching profiles:", profError);
      return NextResponse.json(
        { success: false, error: profError.message, users: [] },
        { status: 500 }
      );
    }

    // 2. Fetch wallets, deposits, withdrawals, trades, ads, disputes in parallel
    const [
      { data: wallets },
      { data: deposits },
      { data: withdrawals },
      { data: trades },
      { data: ads },
      { data: disputes },
    ] = await Promise.all([
      supabase.from("wallets").select("*"),
      supabase.from("deposits").select("id, user_id, amount, crypto, status, tx_id"),
      supabase.from("withdrawals").select("id, user_id, amount, crypto, status, txid"),
      supabase.from("trades").select("id, trade_id, buyer_id, seller_id, crypto, amount, status"),
      supabase.from("advertisements").select("id, user_id, crypto_currency, type, is_active"),
      supabase.from("disputes").select("id, trade_id, opened_by_id, status"),
    ]);

    // Aggregate user-level financial and activity metrics
    const walletMap = new Map<string, any[]>();
    (wallets || []).forEach((w: any) => {
      if (!walletMap.has(w.user_id)) walletMap.set(w.user_id, []);
      walletMap.get(w.user_id)!.push(w);
    });

    // Deposits total per user per currency
    const depositTotalsMap = new Map<string, Record<string, number>>();
    (deposits || []).forEach((d: any) => {
      const uId = d.user_id;
      if (!depositTotalsMap.has(uId)) depositTotalsMap.set(uId, {});
      const userTotals = depositTotalsMap.get(uId)!;
      const crypto = (d.crypto || "USDT").toUpperCase();
      const amt = parseFloat(d.amount) || 0;
      userTotals[crypto] = (userTotals[crypto] || 0) + amt;
    });

    // Withdrawals total per user per currency
    const withdrawalTotalsMap = new Map<string, Record<string, number>>();
    (withdrawals || []).forEach((w: any) => {
      const uId = w.user_id;
      if (!withdrawalTotalsMap.has(uId)) withdrawalTotalsMap.set(uId, {});
      const userTotals = withdrawalTotalsMap.get(uId)!;
      const crypto = (w.crypto || "USDT").toUpperCase();
      const amt = parseFloat(w.amount) || 0;
      userTotals[crypto] = (userTotals[crypto] || 0) + amt;
    });

    // Trades count per user
    const tradeCountsMap = new Map<string, { total: number; completed: number; active: number }>();
    (trades || []).forEach((t: any) => {
      [t.buyer_id, t.seller_id].filter(Boolean).forEach((uId: string) => {
        if (!tradeCountsMap.has(uId)) tradeCountsMap.set(uId, { total: 0, completed: 0, active: 0 });
        const c = tradeCountsMap.get(uId)!;
        c.total += 1;
        if (t.status === "completed" || t.status === "released") c.completed += 1;
        if (t.status === "active" || t.status === "escrow_locked") c.active += 1;
      });
    });

    // Ads count per user
    const adsCountMap = new Map<string, { total: number; active: number }>();
    (ads || []).forEach((a: any) => {
      const uId = a.user_id;
      if (!adsCountMap.has(uId)) adsCountMap.set(uId, { total: 0, active: 0 });
      const c = adsCountMap.get(uId)!;
      c.total += 1;
      if (a.is_active) c.active += 1;
    });

    // Disputes count per user
    const disputesCountMap = new Map<string, number>();
    (disputes || []).forEach((d: any) => {
      const uId = d.opened_by_id;
      if (uId) {
        disputesCountMap.set(uId, (disputesCountMap.get(uId) || 0) + 1);
      }
    });

    // Identify users associated with specific searched entity IDs if query exists
    const matchedUserIdsFromAssociatedEntities = new Set<string>();
    if (query) {
      (trades || []).forEach((t: any) => {
        if (
          t.id?.toLowerCase().includes(query) ||
          t.trade_id?.toLowerCase().includes(query)
        ) {
          if (t.buyer_id) matchedUserIdsFromAssociatedEntities.add(t.buyer_id);
          if (t.seller_id) matchedUserIdsFromAssociatedEntities.add(t.seller_id);
        }
      });
      (deposits || []).forEach((d: any) => {
        if (
          d.id?.toLowerCase().includes(query) ||
          d.tx_id?.toLowerCase().includes(query)
        ) {
          if (d.user_id) matchedUserIdsFromAssociatedEntities.add(d.user_id);
        }
      });
      (withdrawals || []).forEach((w: any) => {
        if (
          w.id?.toLowerCase().includes(query) ||
          w.txid?.toLowerCase().includes(query)
        ) {
          if (w.user_id) matchedUserIdsFromAssociatedEntities.add(w.user_id);
        }
      });
      (ads || []).forEach((a: any) => {
        if (a.id?.toLowerCase().includes(query)) {
          if (a.user_id) matchedUserIdsFromAssociatedEntities.add(a.user_id);
        }
      });
    }

    const combinedUsers = (profiles || []).map((p: any) => {
      const userWallets = walletMap.get(p.id) || [];
      const balanceMap: Record<string, number> = {};
      userWallets.forEach((w: any) => {
        const curr = (w.currency || "USDT").toUpperCase();
        balanceMap[curr] = (balanceMap[curr] || 0) + (parseFloat(w.balance) || 0);
      });

      const tradeCounts = tradeCountsMap.get(p.id) || { total: p.completed_trades || 0, completed: p.completed_trades || 0, active: 0 };
      const userAds = adsCountMap.get(p.id) || { total: 0, active: 0 };
      const userDisputes = disputesCountMap.get(p.id) || 0;

      return {
        ...p,
        status: p.status || (p.is_banned ? "Banned" : p.is_suspended ? "Suspended" : "Active"),
        wallets: userWallets,
        balances: balanceMap,
        depositTotals: depositTotalsMap.get(p.id) || {},
        withdrawalTotals: withdrawalTotalsMap.get(p.id) || {},
        tradeCounts,
        adsCount: userAds,
        disputesCount: userDisputes,
      };
    });

    let filteredUsers = combinedUsers;
    if (query) {
      filteredUsers = combinedUsers.filter((u: any) => {
        const idMatch = u.id?.toLowerCase().includes(query);
        const customIdMatch = u.user_custom_id?.toLowerCase().includes(query);
        const nameMatch = u.full_name?.toLowerCase().includes(query);
        const emailMatch = u.email?.toLowerCase().includes(query);
        const roleMatch = u.role?.toLowerCase().includes(query);
        const statusMatch = u.status?.toLowerCase().includes(query);
        const associatedEntityMatch = matchedUserIdsFromAssociatedEntities.has(u.id);

        return idMatch || customIdMatch || nameMatch || emailMatch || roleMatch || statusMatch || associatedEntityMatch;
      });
    }

    return NextResponse.json({
      success: true,
      users: filteredUsers,
      totalCount: combinedUsers.length,
      filteredCount: filteredUsers.length,
    });
  } catch (err: any) {
    console.error("[API/ADMIN/USERS] Internal error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error", users: [] },
      { status: 500 }
    );
  }
}
