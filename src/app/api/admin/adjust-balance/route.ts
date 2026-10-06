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

    // 4. Fetch existing authoritative wallet balance from wallet_assets
    const { data: existingAsset } = await supabase
      .from("wallet_assets")
      .select("*")
      .eq("user_id", profile.id)
      .eq("asset_symbol", cleanCurrency)
      .maybeSingle();

    const currentBalance = existingAsset ? parseFloat(existingAsset.balance) || 0 : 0;

    if (cleanAction === "subtract" && currentBalance < numAmount) {
      return NextResponse.json({
        success: false,
        error: `Insufficient balance. User only has ${currentBalance.toFixed(8)} ${cleanCurrency}. Cannot subtract ${numAmount.toFixed(8)} ${cleanCurrency}.`,
      }, { status: 400 });
    }

    // 5. Execute authoritative balance adjustment on wallet_assets
    const newBalance: number = cleanAction === "add" ? currentBalance + numAmount : Math.max(0, currentBalance - numAmount);

    if (existingAsset) {
      const { error: waUpdateErr } = await supabase
        .from("wallet_assets")
        .update({
          balance: newBalance,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingAsset.id);

      if (waUpdateErr) {
        console.error("[ADJUST_BALANCE] wallet_assets update error:", waUpdateErr);
        return NextResponse.json({ success: false, error: "Failed to update authoritative wallet balance." }, { status: 500 });
      }
    } else {
      const { error: waInsertErr } = await supabase
        .from("wallet_assets")
        .insert({
          user_id: profile.id,
          asset_symbol: cleanCurrency,
          balance: newBalance,
          locked_balance: 0,
          reserved_balance: 0,
          in_escrow: 0,
          in_withdrawal: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

      if (waInsertErr) {
        console.error("[ADJUST_BALANCE] wallet_assets insert error:", waInsertErr);
        return NextResponse.json({ success: false, error: "Failed to initialize authoritative wallet balance." }, { status: 500 });
      }
    }

    // 6. Create Ledger Entry in authoritative ledger_entries
    try {
      await supabase.from("ledger_entries").insert({
        user_id: profile.id,
        crypto: cleanCurrency,
        asset: cleanCurrency,
        amount: cleanAction === "add" ? numAmount : -numAmount,
        type: `admin_${cleanAction}`,
        status: "completed",
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
