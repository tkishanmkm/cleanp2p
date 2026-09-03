import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> | { userId: string } }
) {
  try {
    const resolvedParams = typeof (params as any)?.then === "function" ? await params : params;
    const userId = resolvedParams.userId;

    if (!userId) {
      return NextResponse.json({ success: false, error: "Missing userId" }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();

    // 1. Fetch user profile
    const { data: profile, error: profError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (profError || !profile) {
      return NextResponse.json(
        { success: false, error: profError?.message || "User profile not found" },
        { status: 404 }
      );
    }

    // 2. Fetch associated records
    const [
      { data: wallets },
      { data: depositAddresses },
      { data: deposits },
      { data: withdrawals },
      { data: tradesBuyer },
      { data: tradesSeller },
      { data: ads },
      { data: transactions },
      { data: auditLogs },
    ] = await Promise.all([
      supabase.from("wallets").select("*").eq("user_id", userId),
      supabase.from("deposit_addresses").select("*").eq("user_id", userId),
      supabase.from("deposits").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("withdrawals").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("trades").select("*").eq("buyer_id", userId).order("created_at", { ascending: false }),
      supabase.from("trades").select("*").eq("seller_id", userId).order("created_at", { ascending: false }),
      supabase.from("advertisements").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("wallet_transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("admin_audit_logs").select("*").eq("target_user_id", userId).order("created_at", { ascending: false }),
    ]);

    const combinedTrades = [...(tradesBuyer || []), ...(tradesSeller || [])].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // Compute balance dictionary and map wallets with provisioned addresses
    const addressMap = new Map<string, any>();
    (depositAddresses || []).forEach((addr: any) => {
      const key = `${(addr.currency || addr.crypto || 'USDT').toUpperCase()}_${(addr.network || 'default').toUpperCase()}`;
      addressMap.set(key, addr);
      addressMap.set((addr.currency || addr.crypto || 'USDT').toUpperCase(), addr);
    });

    const enrichedWallets = (wallets || []).map((w: any) => {
      const curr = (w.currency || "USDT").toUpperCase();
      const addrInfo = addressMap.get(curr);
      const balance = parseFloat(w.balance) || 0;
      const reserved = parseFloat(w.reserved_balance) || 0;
      return {
        ...w,
        currency: curr,
        balance,
        reserved_balance: reserved,
        available_balance: Math.max(0, balance - reserved),
        deposit_address: w.address || addrInfo?.address || null,
        network: w.network || addrInfo?.network || "DEFAULT",
      };
    });

    const balances: Record<string, { balance: number; reserved: number; available: number }> = {};
    enrichedWallets.forEach((w: any) => {
      balances[w.currency] = {
        balance: w.balance,
        reserved: w.reserved_balance,
        available: w.available_balance,
      };
    });

    // Compute deposit attempts breakdown
    const depositSummary = {
      totalCount: (deposits || []).length,
      creditedCount: 0,
      pendingCount: 0,
      failedCount: 0,
      creditedAmountByCrypto: {} as Record<string, number>,
      pendingAmountByCrypto: {} as Record<string, number>,
    };

    const normalizedDeposits = (deposits || []).map((d: any) => {
      const crypto = (d.crypto || d.currency || "USDT").toUpperCase();
      const amt = parseFloat(d.amount) || 0;
      const status = (d.status || "pending").toLowerCase();

      if (status === "completed" || status === "credited" || status === "confirmed") {
        depositSummary.creditedCount += 1;
        depositSummary.creditedAmountByCrypto[crypto] = (depositSummary.creditedAmountByCrypto[crypto] || 0) + amt;
      } else if (status === "failed" || status === "rejected" || status === "cancelled" || status === "expired") {
        depositSummary.failedCount += 1;
      } else {
        depositSummary.pendingCount += 1;
        depositSummary.pendingAmountByCrypto[crypto] = (depositSummary.pendingAmountByCrypto[crypto] || 0) + amt;
      }

      return {
        id: d.id,
        crypto,
        currency: crypto,
        amount: amt,
        status: d.status,
        tx_hash: d.tx_id || d.tx_hash || d.hash || null,
        address: d.address || d.to_address || null,
        network: d.network || null,
        confirmations: d.confirmations ?? 0,
        required_confirmations: d.required_confirmations ?? 1,
        created_at: d.created_at,
        updated_at: d.updated_at,
      };
    });

    // Compute withdrawal totals by crypto
    const withdrawalTotals: Record<string, number> = {};
    (withdrawals || []).forEach((w: any) => {
      const crypto = (w.crypto || "USDT").toUpperCase();
      withdrawalTotals[crypto] = (withdrawalTotals[crypto] || 0) + (parseFloat(w.amount) || 0);
    });

    return NextResponse.json({
      success: true,
      user: {
        ...profile,
        status: profile.status || (profile.is_banned ? "Banned" : profile.is_suspended ? "Suspended" : "Active"),
        wallets: enrichedWallets,
        depositAddresses: depositAddresses || [],
        balances,
        depositSummary,
        depositTotals: depositSummary.creditedAmountByCrypto,
        withdrawalTotals,
        deposits: normalizedDeposits,
        withdrawals: withdrawals || [],
        trades: combinedTrades,
        ads: ads || [],
        transactions: transactions || [],
        auditLogs: auditLogs || [],
      },
    });
  } catch (err: any) {
    console.error("[API/ADMIN/USER_DETAILS] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> | { userId: string } }
) {
  try {
    const resolvedParams = typeof (params as any)?.then === "function" ? await params : params;
    const userId = resolvedParams.userId;

    const body = await req.json();
    const { action, status, reason, banPolicy, role, adminEmail } = body;
    const supabase = getSupabaseAdminClient();

    if (action === "update_status") {
      const targetStatus = (status || "active").toLowerCase();
      const isBanned = targetStatus === "banned";
      const isSuspended = targetStatus === "suspended";

      // 1. Try DB RPC
      try {
        await supabase.rpc("admin_update_user_status", {
          p_admin_email: adminEmail || "admin@paxones.com",
          p_target_user_id: userId,
          p_status: targetStatus,
          p_ban_reason: reason || `Admin updated status to ${targetStatus}`,
          p_ban_policy: banPolicy || "block_withdrawals",
        });
      } catch (rpcErr) {
        console.warn("admin_update_user_status RPC fallback:", rpcErr);
      }

      // 2. Ensure profiles table updated directly
      await supabase
        .from("profiles")
        .update({
          status: targetStatus,
          is_banned: isBanned,
          is_suspended: isSuspended,
          ban_reason: isBanned ? (reason || "Admin administrative ban") : null,
          banned_at: isBanned ? new Date().toISOString() : null,
        })
        .eq("id", userId);

      // 3. Log audit event
      await supabase.from("admin_audit_logs").insert({
        admin_email: adminEmail || "admin@paxones.com",
        action: `SET_STATUS_${targetStatus.toUpperCase()}`,
        target_user_id: userId,
        details: { status: targetStatus, reason, banPolicy, date: new Date().toISOString() },
      });

      return NextResponse.json({ success: true, message: `Status updated to ${targetStatus}` });
    }

    if (action === "update_role") {
      const newRole = role === "admin" ? "admin" : "user";
      await supabase
        .from("profiles")
        .update({
          role: newRole,
          is_admin_account: newRole === "admin",
        })
        .eq("id", userId);

      if (newRole === "admin") {
        await supabase
          .from("app_admins")
          .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id" });
      } else {
        await supabase.from("app_admins").delete().eq("user_id", userId);
      }

      await supabase.from("admin_audit_logs").insert({
        admin_email: adminEmail || "admin@paxones.com",
        action: `SET_ROLE_${newRole.toUpperCase()}`,
        target_user_id: userId,
        details: { role: newRole, date: new Date().toISOString() },
      });

      return NextResponse.json({ success: true, message: `Role updated to ${newRole}` });
    }

    return NextResponse.json({ success: false, error: "Unsupported action" }, { status: 400 });
  } catch (err: any) {
    console.error("[API/ADMIN/USER_ACTION] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
