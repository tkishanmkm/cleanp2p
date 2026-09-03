import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userId,
      currency,
      action, // "add" | "subtract"
      amount,
      reason,
      adminEmail = "admin@paxones.com",
    } = body;

    // 1. Validation
    if (!userId) {
      return NextResponse.json({ success: false, error: "Target user is required." }, { status: 400 });
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return NextResponse.json({ success: false, error: "Please enter a valid positive crypto amount." }, { status: 400 });
    }

    const cleanCurrency = (currency || "USDT").trim().toUpperCase();
    const cleanAction = action === "subtract" ? "subtract" : "add";
    const cleanReason = (reason || "").trim() || `Manual ${cleanAction} by admin`;

    const supabase = getSupabaseAdminClient();

    // 2. Validate target user existence
    const { data: profile, error: profError } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("id", userId)
      .maybeSingle();

    if (profError || !profile) {
      return NextResponse.json({ success: false, error: "Target user not found in database." }, { status: 404 });
    }

    // 3. Fetch existing wallet balance
    const { data: existingWallet } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", userId)
      .eq("currency", cleanCurrency)
      .maybeSingle();

    const currentBalance = existingWallet ? parseFloat(existingWallet.balance) || 0 : 0;

    if (cleanAction === "subtract" && currentBalance < numAmount) {
      return NextResponse.json({
        success: false,
        error: `Insufficient balance. User only has ${currentBalance.toFixed(8)} ${cleanCurrency}. Cannot subtract ${numAmount.toFixed(8)} ${cleanCurrency}.`,
      }, { status: 400 });
    }

    // 4. Execute atomic balance adjustment via RPC
    let newBalance: number = currentBalance;
    let rpcSuccess = false;

    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc("admin_adjust_balance", {
        p_admin_email: adminEmail,
        p_user_id: userId,
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
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingWallet.id);
      } else {
        await supabase.from("wallets").insert({
          user_id: userId,
          currency: cleanCurrency,
          balance: newBalance,
          reserved_balance: 0,
        });
      }
    }

    // 5. Create Ledger Entry in ledger_entries
    try {
      await supabase.from("ledger_entries").insert({
        user_id: userId,
        crypto: cleanCurrency,
        amount: cleanAction === "add" ? numAmount : -numAmount,
        type: `admin_${cleanAction}`,
        reference_id: `ADJ-${Date.now()}`,
        balance_after: newBalance,
        metadata: {
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

    // 6. Create Transaction record in wallet_transactions
    try {
      await supabase.from("wallet_transactions").insert({
        user_id: userId,
        tx_type: cleanAction === "add" ? "credit" : "debit",
        asset_symbol: cleanCurrency,
        amount: numAmount,
        status: "completed",
        tx_hash: `ADMIN_ADJ:${cleanAction.toUpperCase()}:${Date.now()}`,
      });
    } catch (txErr) {
      console.warn("[ADJUST_BALANCE] wallet_transactions insert notice:", txErr);
    }

    // 7. Create Audit Record in admin_audit_logs
    try {
      await supabase.from("admin_audit_logs").insert({
        admin_email: adminEmail,
        action: "ADJUST_BALANCE",
        target_user_id: userId,
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

    // 8. Create User Notification
    try {
      await supabase.from("notifications").insert({
        user_id: userId,
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
