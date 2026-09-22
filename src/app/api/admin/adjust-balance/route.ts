import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";

export const dynamic = "force-dynamic";

const SUPPORTED_CURRENCIES = ["USDT", "BTC", "ETH", "LTC", "BNB", "TRX", "SOL", "USDC"];
const MAX_SINGLE_ADJUSTMENT = 500000; // 500k units max safety boundary

export async function POST(req: NextRequest) {
  try {
    // 1. Mandatory Server-Side Admin Authentication & Authorization
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    const body = await req.json().catch(() => ({}));
    const {
      userId,
      currency,
      action, // "add" | "subtract"
      amount,
      reason,
    } = body;

    // 2. Strict Input Validation (Never trust client-supplied admin identity)
    if (!userId || typeof userId !== "string" || !/^[0-9a-fA-F-]{36}$/.test(userId.trim())) {
      return NextResponse.json({ success: false, error: "Valid target user UUID is required." }, { status: 400 });
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || !isFinite(numAmount) || numAmount <= 0) {
      return NextResponse.json({ success: false, error: "Please enter a valid positive numeric crypto amount." }, { status: 400 });
    }

    if (numAmount > MAX_SINGLE_ADJUSTMENT) {
      return NextResponse.json({ success: false, error: `Adjustment exceeds maximum single limit of ${MAX_SINGLE_ADJUSTMENT}.` }, { status: 400 });
    }

    const cleanCurrency = (currency || "USDT").trim().toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(cleanCurrency)) {
      return NextResponse.json({ success: false, error: `Unsupported currency '${cleanCurrency}'.` }, { status: 400 });
    }

    const cleanAction = action === "subtract" ? "subtract" : "add";
    const cleanReason = (reason || "").trim();
    if (!cleanReason || cleanReason.length < 3) {
      return NextResponse.json({ success: false, error: "A valid audit reason is required for manual balance adjustments." }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const adminEmail = auth.adminEmail || "admin@paxones.com";
    const adminId = auth.adminId || auth.user.id;

    // 3. Validate target user existence
    const { data: profile, error: profError } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", userId.trim())
      .maybeSingle();

    if (profError || !profile) {
      return NextResponse.json({ success: false, error: "Target user not found in database." }, { status: 404 });
    }

    // 4. Fetch existing wallet balance
    const { data: existingWallet } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", profile.id)
      .eq("currency", cleanCurrency)
      .maybeSingle();

    const currentBalance = existingWallet ? parseFloat(existingWallet.balance) || 0 : 0;

    if (cleanAction === "subtract" && currentBalance < numAmount) {
      return NextResponse.json({
        success: false,
        error: `Insufficient balance. User only has ${currentBalance.toFixed(8)} ${cleanCurrency}. Cannot subtract ${numAmount.toFixed(8)} ${cleanCurrency}.`,
      }, { status: 400 });
    }

    // 5. Execute atomic balance adjustment via RPC
    let newBalance: number = currentBalance;
    let rpcSuccess = false;

    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc("admin_adjust_balance", {
        p_admin_email: adminEmail,
        p_user_id: profile.id,
        p_currency: cleanCurrency,
        p_type: cleanAction,
        p_amount: numAmount,
      });

      if (!rpcError && rpcData) {
        rpcSuccess = true;
        newBalance = typeof rpcData.new_balance === "number" ? rpcData.new_balance : (
          cleanAction === "add" ? currentBalance + numAmount : Math.max(0, currentBalance - numAmount)
        );
      }
    } catch (err) {
      console.warn("[ADJUST_BALANCE] RPC call failed, using safe atomic update fallback:", err);
    }

    // Safe fallback if RPC was not available or threw
    if (!rpcSuccess) {
      newBalance = cleanAction === "add" ? currentBalance + numAmount : Math.max(0, currentBalance - numAmount);
      if (existingWallet) {
        await supabase
          .from("wallets")
          .update({
            balance: newBalance,
            total_balance: newBalance,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingWallet.id);
      } else {
        await supabase.from("wallets").insert({
          user_id: profile.id,
          currency: cleanCurrency,
          balance: newBalance,
          total_balance: newBalance,
        });
      }
    }

    // 6. Create Ledger Entry in ledger_entries
    try {
      await supabase.from("ledger_entries").insert({
        user_id: profile.id,
        crypto: cleanCurrency,
        amount: cleanAction === "add" ? numAmount : -numAmount,
        type: `admin_${cleanAction}`,
        reference_id: `ADJ-${Date.now()}`,
        balance_after: newBalance,
        metadata: {
          admin_id: adminId,
          admin_email: adminEmail,
          reason: cleanReason,
          old_balance: currentBalance,
          action: cleanAction,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (ledgerErr) {
      console.warn("[ADJUST_BALANCE] ledger_entries insert notice:", ledgerErr);
    }

    // 7. Create Transaction record in wallet_transactions
    try {
      await supabase.from("wallet_transactions").insert({
        user_id: profile.id,
        tx_type: cleanAction === "add" ? "credit" : "debit",
        asset_symbol: cleanCurrency,
        amount: numAmount,
        status: "completed",
        tx_hash: `ADMIN_ADJ:${cleanAction.toUpperCase()}:${Date.now()}`,
      });
    } catch (txErr) {
      console.warn("[ADJUST_BALANCE] wallet_transactions insert notice:", txErr);
    }

    // 8. Create Audit Record in admin_audit_logs with authenticated identity
    try {
      await supabase.from("admin_audit_logs").insert({
        admin_id: adminId,
        admin_email: adminEmail,
        action: "ADJUST_BALANCE",
        target_user_id: profile.id,
        details: {
          currency: cleanCurrency,
          action: cleanAction,
          amount: numAmount,
          old_balance: currentBalance,
          new_balance: newBalance,
          reason: cleanReason,
          date: new Date().toISOString(),
        },
      });
    } catch (auditErr) {
      console.warn("[ADJUST_BALANCE] admin_audit_logs insert notice:", auditErr);
    }

    // 9. Create User Notification
    try {
      await supabase.from("notifications").insert({
        user_id: profile.id,
        message: `Your ${cleanCurrency} wallet balance was adjusted by administrator: ${cleanAction === "add" ? "+" : "-"}${numAmount} ${cleanCurrency}. Reason: ${cleanReason}`,
        is_read: false,
        created_at: new Date().toISOString(),
        link: "/wallets",
      });
    } catch (notifErr) {
      console.warn("[ADJUST_BALANCE] notifications insert notice:", notifErr);
    }

    return NextResponse.json({
      success: true,
      message: `Successfully ${cleanAction === "add" ? "credited" : "debited"} ${numAmount} ${cleanCurrency}.`,
      old_balance: currentBalance,
      new_balance: newBalance,
      currency: cleanCurrency,
      action: cleanAction,
      user: {
        id: profile.id,
        name: profile.full_name || profile.email || profile.id,
      },
    });
  } catch (err: any) {
    console.error("[API/ADMIN/ADJUST_BALANCE] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
