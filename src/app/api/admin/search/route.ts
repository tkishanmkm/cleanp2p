import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = (searchParams.get("q") || "").trim();

    if (!query) {
      return NextResponse.json({
        success: true,
        query: "",
        results: {
          users: [],
          trades: [],
          deposits: [],
          withdrawals: [],
          ads: [],
          disputes: [],
        },
        totalMatches: 0,
      });
    }

    const supabase = getSupabaseAdminClient();
    const lQuery = query.toLowerCase();

    // Parallel fetch from all relevant tables
    const [
      { data: profiles },
      { data: trades },
      { data: deposits },
      { data: withdrawals },
      { data: ads },
      { data: disputes },
    ] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("trades").select("*"),
      supabase.from("deposits").select("*"),
      supabase.from("withdrawals").select("*"),
      supabase.from("advertisements").select("*"),
      supabase.from("disputes").select("*"),
    ]);

    // Build user lookup map
    const userMap = new Map<string, any>();
    (profiles || []).forEach((p: any) => {
      userMap.set(p.id, p);
    });

    // 1. Search Users
    const matchedUsers = (profiles || []).filter((u: any) => {
      return (
        u.id?.toLowerCase().includes(lQuery) ||
        u.user_custom_id?.toLowerCase().includes(lQuery) ||
        u.full_name?.toLowerCase().includes(lQuery) ||
        u.email?.toLowerCase().includes(lQuery) ||
        u.role?.toLowerCase().includes(lQuery) ||
        u.status?.toLowerCase().includes(lQuery)
      );
    });

    // 2. Search Trades
    const matchedTrades = (trades || []).filter((t: any) => {
      return (
        t.id?.toLowerCase().includes(lQuery) ||
        t.trade_id?.toLowerCase().includes(lQuery) ||
        t.ad_id?.toLowerCase().includes(lQuery) ||
        t.buyer_id?.toLowerCase().includes(lQuery) ||
        t.seller_id?.toLowerCase().includes(lQuery) ||
        t.crypto?.toLowerCase().includes(lQuery) ||
        t.crypto_currency?.toLowerCase().includes(lQuery) ||
        t.status?.toLowerCase().includes(lQuery)
      );
    }).map((t: any) => ({
      ...t,
      buyer: userMap.get(t.buyer_id) || null,
      seller: userMap.get(t.seller_id) || null,
    }));

    // 3. Search Deposits
    const matchedDeposits = (deposits || []).filter((d: any) => {
      return (
        d.id?.toLowerCase().includes(lQuery) ||
        d.user_id?.toLowerCase().includes(lQuery) ||
        d.tx_id?.toLowerCase().includes(lQuery) ||
        d.wallet_address?.toLowerCase().includes(lQuery) ||
        d.crypto?.toLowerCase().includes(lQuery) ||
        d.status?.toLowerCase().includes(lQuery)
      );
    }).map((d: any) => ({
      ...d,
      user: userMap.get(d.user_id) || null,
    }));

    // 4. Search Withdrawals
    const matchedWithdrawals = (withdrawals || []).filter((w: any) => {
      return (
        w.id?.toLowerCase().includes(lQuery) ||
        w.user_id?.toLowerCase().includes(lQuery) ||
        w.txid?.toLowerCase().includes(lQuery) ||
        w.to_address?.toLowerCase().includes(lQuery) ||
        w.crypto?.toLowerCase().includes(lQuery) ||
        w.status?.toLowerCase().includes(lQuery)
      );
    }).map((w: any) => ({
      ...w,
      user: userMap.get(w.user_id) || null,
    }));

    // 5. Search Ads
    const matchedAds = (ads || []).filter((a: any) => {
      return (
        a.id?.toLowerCase().includes(lQuery) ||
        a.user_id?.toLowerCase().includes(lQuery) ||
        a.crypto_currency?.toLowerCase().includes(lQuery) ||
        a.type?.toLowerCase().includes(lQuery)
      );
    }).map((a: any) => ({
      ...a,
      user: userMap.get(a.user_id) || null,
    }));

    // 6. Search Disputes
    const matchedDisputes = (disputes || []).filter((disp: any) => {
      return (
        disp.id?.toLowerCase().includes(lQuery) ||
        disp.trade_id?.toLowerCase().includes(lQuery) ||
        disp.opened_by_id?.toLowerCase().includes(lQuery) ||
        disp.reason?.toLowerCase().includes(lQuery) ||
        disp.status?.toLowerCase().includes(lQuery)
      );
    }).map((disp: any) => ({
      ...disp,
      opened_by: userMap.get(disp.opened_by_id) || null,
    }));

    // Cross-link: If an operational record matched, ensure the associated user is also included in users section
    const userIdsFromEntities = new Set<string>();
    matchedTrades.forEach((t: any) => {
      if (t.buyer_id) userIdsFromEntities.add(t.buyer_id);
      if (t.seller_id) userIdsFromEntities.add(t.seller_id);
    });
    matchedDeposits.forEach((d: any) => {
      if (d.user_id) userIdsFromEntities.add(d.user_id);
    });
    matchedWithdrawals.forEach((w: any) => {
      if (w.user_id) userIdsFromEntities.add(w.user_id);
    });
    matchedAds.forEach((a: any) => {
      if (a.user_id) userIdsFromEntities.add(a.user_id);
    });
    matchedDisputes.forEach((disp: any) => {
      if (disp.opened_by_id) userIdsFromEntities.add(disp.opened_by_id);
    });

    const alreadyMatchedUserIds = new Set(matchedUsers.map((u: any) => u.id));
    userIdsFromEntities.forEach((uId) => {
      if (!alreadyMatchedUserIds.has(uId) && userMap.has(uId)) {
        matchedUsers.push({
          ...userMap.get(uId),
          _matchedViaAssociatedRecord: true,
        });
        alreadyMatchedUserIds.add(uId);
      }
    });

    const totalMatches =
      matchedUsers.length +
      matchedTrades.length +
      matchedDeposits.length +
      matchedWithdrawals.length +
      matchedAds.length +
      matchedDisputes.length;

    return NextResponse.json({
      success: true,
      query,
      results: {
        users: matchedUsers,
        trades: matchedTrades,
        deposits: matchedDeposits,
        withdrawals: matchedWithdrawals,
        ads: matchedAds,
        disputes: matchedDisputes,
      },
      totalMatches,
    });
  } catch (err: any) {
    console.error("[API/ADMIN/SEARCH] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
