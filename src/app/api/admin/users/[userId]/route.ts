import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { fetchAllSupabaseRows } from "@/lib/supabase/fetch-all-pages";
import { normalizePrimaryWalletAssetBalance } from "@/lib/wallet-balance-normalization";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const auth = await verifyServerAdmin(req, { allowSupportReadOnly: true });
    if (!auth.authorized) return auth.response!;
    if (auth.supportAdmin === true || auth.supportReadOnly === true) {
      return NextResponse.json(
        { success: false, error: "Full administrator access is required to view complete user financial, KYC and audit records." },
        { status: 403 }
      );
    }

    const resolvedParams = await params;
    const userId = String(resolvedParams.userId || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return NextResponse.json({ success: false, error: "A valid user UUID is required." }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();

    // 1. Fetch user profile
    const { data: profile, error: profError } = await supabase
      .from("profiles")
      .select("id, username, display_name, full_name, email, role, is_admin, is_admin_account, status, is_banned, is_suspended, is_on_hold, is_restricted, account_status, created_at, updated_at, completed_trades, total_completed_trades, trade_volume, total_volume_usd, feedback_score, positive_feedback, negative_feedback, avatar_url, photo_url, is_online, last_seen, last_seen_at, country, preferred_currency, kyc_status, is_verified, id_verified, is_emergency_frozen, is_minor_restricted, is_kyc_locked, username_changed, username_changed_count, username_changes_remaining, merchant_tier, merchant_status, ban_reason, banned_at, is_withdrawal_locked")
      .eq("id", userId)
      .maybeSingle();

    if (profError || !profile) {
      return NextResponse.json(
        { success: false, error: "User profile could not be loaded." },
        { status: profError ? 503 : 404 }
      );
    }

    // 2. Fetch associated records with hard row caps; errors or truncated
    // result sets fail closed so admins never act on incomplete financial history.
    const pageOptions = { pageSize: 1000, maxRows: 20000 };
    const [
      walletAssetsResult,
      depositAddressesResult,
      depositsResult,
      onchainDepositsResult,
      legacyWithdrawalsResult,
      onchainWithdrawalsResult,
      tradesBuyerResult,
      tradesSellerResult,
      adsResult,
      transactionsResult,
      auditLogsResult,
    ] = await Promise.all([
      fetchAllSupabaseRows<any>((from, to) => supabase.from("wallet_assets").select("*", { count: "exact" }).eq("user_id", userId).range(from, to), pageOptions),
      fetchAllSupabaseRows<any>((from, to) => supabase.from("deposit_addresses").select("*", { count: "exact" }).eq("user_id", userId).range(from, to), pageOptions),
      fetchAllSupabaseRows<any>((from, to) => supabase.from("deposits").select("*", { count: "exact" }).eq("user_id", userId).order("created_at", { ascending: false }).range(from, to), pageOptions),
      fetchAllSupabaseRows<any>((from, to) => supabase.from("onchain_deposits").select("*", { count: "exact" }).eq("user_id", userId).order("created_at", { ascending: false }).range(from, to), pageOptions),
      fetchAllSupabaseRows<any>((from, to) => supabase.from("withdrawals").select("*", { count: "exact" }).eq("user_id", userId).order("created_at", { ascending: false }).range(from, to), pageOptions),
      fetchAllSupabaseRows<any>((from, to) => supabase.from("onchain_withdrawals").select("*", { count: "exact" }).eq("user_id", userId).order("created_at", { ascending: false }).range(from, to), pageOptions),
      fetchAllSupabaseRows<any>((from, to) => supabase.from("trades").select("*", { count: "exact" }).eq("buyer_id", userId).order("created_at", { ascending: false }).range(from, to), pageOptions),
      fetchAllSupabaseRows<any>((from, to) => supabase.from("trades").select("*", { count: "exact" }).eq("seller_id", userId).order("created_at", { ascending: false }).range(from, to), pageOptions),
      fetchAllSupabaseRows<any>((from, to) => supabase.from("advertisements").select("*", { count: "exact" }).eq("user_id", userId).order("created_at", { ascending: false }).range(from, to), pageOptions),
      fetchAllSupabaseRows<any>((from, to) => supabase.from("wallet_transactions").select("*", { count: "exact" }).eq("user_id", userId).order("created_at", { ascending: false }).range(from, to), pageOptions),
      fetchAllSupabaseRows<any>((from, to) => supabase.from("admin_audit_logs").select("*", { count: "exact" }).eq("target_user_id", userId).order("created_at", { ascending: false }).range(from, to), pageOptions),
    ]);

    const associatedResults = [
      walletAssetsResult, depositAddressesResult, depositsResult, onchainDepositsResult,
      legacyWithdrawalsResult, onchainWithdrawalsResult, tradesBuyerResult,
      tradesSellerResult, adsResult, transactionsResult, auditLogsResult,
    ];
    if (associatedResults.some((result) => result.error || result.truncated)) {
      console.error("[API/ADMIN/USER_DETAILS] One or more associated reads failed or exceeded the safe cap.");
      return NextResponse.json(
        { success: false, error: "User financial and audit history could not be fully verified." },
        { status: 503 }
      );
    }

    const walletAssets = walletAssetsResult.rows;
    const depositAddresses = depositAddressesResult.rows;
    const legacyDeposits = depositsResult.rows;
    const tradesBuyer = tradesBuyerResult.rows;
    const tradesSeller = tradesSellerResult.rows;
    const ads = adsResult.rows;
    const transactions = transactionsResult.rows;
    const auditLogs = auditLogsResult.rows;

    // Prefer canonical on-chain withdrawal records. Merge legacy history only
    // when its network + transaction hash identity is not already present.
    const withdrawals = onchainWithdrawalsResult.rows.slice();
    const withdrawalKeys = new Set(
      withdrawals.map((row: any) => {
        const tx = String(row.tx_hash || row.txid || "").trim().toLowerCase();
        return tx ? String(row.network || row.network_code || "").toUpperCase() + ":" + tx : "id:" + row.id;
      })
    );
    for (const row of legacyWithdrawalsResult.rows) {
      const tx = String(row.tx_hash || row.txid || "").trim().toLowerCase();
      const key = tx ? String(row.network || row.network_code || row.chain || "").toUpperCase() + ":" + tx : "id:" + row.id;
      if (!withdrawalKeys.has(key)) {
        withdrawalKeys.add(key);
        withdrawals.push(row);
      }
    }
    withdrawals.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const combinedTrades = [...(tradesBuyer || []), ...(tradesSeller || [])].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // Compute balance dictionary and map wallets with provisioned addresses
    const addressMap = new Map<string, any>();
    (depositAddresses || []).forEach((addr: any) => {
      const currency = String(addr.asset_symbol || addr.asset_code || addr.crypto || "USDT").trim().toUpperCase();
      const network = String(addr.network_code || addr.network || addr.chain || "default").trim().toUpperCase();
      addressMap.set(`${currency}_${network}`, addr);
      if (!addressMap.has(currency)) addressMap.set(currency, addr);
    });

    const enrichedWallets = (walletAssets || []).map((wallet: any) => {
      const currency = String(wallet.asset_symbol || "USDT").trim().toUpperCase();
      const addressInfo = addressMap.get(currency);
      const normalized = normalizePrimaryWalletAssetBalance(wallet);
      return {
        id: wallet.id,
        user_id: wallet.user_id,
        currency,
        balance: normalized.available,
        total_balance: normalized.total,
        reserved_balance: normalized.inEscrow + normalized.inWithdrawal,
        available_balance: normalized.available,
        in_escrow: normalized.inEscrow,
        in_withdrawal: normalized.inWithdrawal,
        deposit_address: addressInfo?.address || null,
        network: addressInfo?.network || "DEFAULT",
        updated_at: wallet.updated_at,
      };
    });

    const balances: Record<string, { balance: number; total: number; reserved: number; available: number; in_escrow: number; in_withdrawal: number }> = {};
    for (const wallet of walletAssets || []) {
      const currency = String(wallet.asset_symbol || "USDT").trim().toUpperCase();
      const normalized = normalizePrimaryWalletAssetBalance(wallet);
      balances[currency] = {
        balance: normalized.available,
        total: normalized.total,
        reserved: normalized.inEscrow + normalized.inWithdrawal,
        available: normalized.available,
        in_escrow: normalized.inEscrow,
        in_withdrawal: normalized.inWithdrawal,
      };
    }

    // Canonical on-chain rows win over legacy deposit mirrors. Identity includes
    // output/log index so multiple transfers in one transaction stay distinct.
    const depositIdentity = (row: any, source: "onchain" | "legacy"): string => {
      const txHash = String(row.tx_hash || row.txid || "").trim().toLowerCase();
      if (!txHash) return source + ":" + String(row.id || "");
      const network = String(row.network || row.network_code || row.chain || "").trim().toUpperCase();
      const outputIndex = Number.isSafeInteger(Number(row.output_index)) ? Number(row.output_index) : 0;
      return [network, txHash, String(outputIndex)].join(":");
    };
    const depositByIdentity = new Map<string, any>();
    for (const row of onchainDepositsResult.rows) {
      depositByIdentity.set(depositIdentity(row, "onchain"), row);
    }
    for (const row of legacyDeposits) {
      const key = depositIdentity(row, "legacy");
      if (!depositByIdentity.has(key)) depositByIdentity.set(key, row);
    }
    const mergedDepositRows = Array.from(depositByIdentity.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    // Compute deposit attempts breakdown using actual production columns.
    const depositSummary = {
      totalCount: mergedDepositRows.length,
      creditedCount: 0,
      pendingCount: 0,
      failedCount: 0,
      creditedAmountByCrypto: {} as Record<string, number>,
      pendingAmountByCrypto: {} as Record<string, number>,
    };

    const normalizedDeposits = mergedDepositRows.map((row: any) => {
      const crypto = String(row.asset_symbol || row.asset_code || row.token_symbol || row.asset || "USDT").trim().toUpperCase();
      const amount = Number(row.amount || 0);
      const status = String(row.status || "pending").trim().toLowerCase();
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("Invalid deposit amount encountered while building user details.");
      }

      if (["completed", "credited", "confirmed"].includes(status)) {
        depositSummary.creditedCount += 1;
        depositSummary.creditedAmountByCrypto[crypto] = (depositSummary.creditedAmountByCrypto[crypto] || 0) + amount;
      } else if (["failed", "rejected", "cancelled", "expired"].includes(status)) {
        depositSummary.failedCount += 1;
      } else {
        depositSummary.pendingCount += 1;
        depositSummary.pendingAmountByCrypto[crypto] = (depositSummary.pendingAmountByCrypto[crypto] || 0) + amount;
      }

      return {
        id: row.id,
        crypto,
        currency: crypto,
        amount,
        status: row.status,
        tx_hash: row.tx_hash || row.txid || null,
        output_index: row.output_index ?? 0,
        address: row.address || row.to_address || null,
        network: row.network || row.network_code || row.chain || null,
        confirmations: Number.isInteger(row.confirmations) ? row.confirmations : null,
        required_confirmations: Number.isInteger(row.required_confirmations) ? row.required_confirmations : null,
        created_at: row.created_at,
        updated_at: row.updated_at || row.created_at,
      };
    });

    const withdrawalTotals: Record<string, number> = {};
    for (const withdrawal of withdrawals || []) {
      const currency = String(withdrawal.asset_symbol || withdrawal.asset_code || withdrawal.token_symbol || withdrawal.asset || "USDT").trim().toUpperCase();
      const amount = Number(withdrawal.amount || 0);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("Invalid withdrawal amount encountered while building user details.");
      }
      withdrawalTotals[currency] = (withdrawalTotals[currency] || 0) + amount;
    }

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
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return (
        auth.response ||
        NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
      );
    }

    const resolvedParams = await params;
    const userId = resolvedParams.userId;

    if (typeof userId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return NextResponse.json({ success: false, error: "A valid user UUID is required." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, status, reason, banPolicy, role } = body;
    // Authoritatively resolve admin identity from verified server session
    const adminEmail = auth.adminEmail;
    const adminId = auth.adminId;
    const supabase = getSupabaseAdminClient();

    if (!adminId || !adminEmail) {
      return NextResponse.json(
        { success: false, error: "A verified administrator identity is required." },
        { status: 403 }
      );
    }

    if (action === "update_status") {
      const targetStatus = typeof status === "string" ? status.trim().toLowerCase() : "active";
      const allowedStatuses = new Set(["active", "restricted", "suspended", "banned"]);
      if (!allowedStatuses.has(targetStatus)) {
        return NextResponse.json(
          { success: false, error: "Unsupported account status." },
          { status: 400 }
        );
      }

      const cleanReason = typeof reason === "string" ? reason.trim() : "";
      if (targetStatus === "banned" && (cleanReason.length < 10 || cleanReason.length > 1000)) {
        return NextResponse.json(
          { success: false, error: "A ban reason between 10 and 1000 characters is required." },
          { status: 400 }
        );
      }
      if (targetStatus !== "banned" && cleanReason.length > 1000) {
        return NextResponse.json(
          { success: false, error: "Reason must be 1000 characters or fewer." },
          { status: 400 }
        );
      }

      const allowedBanPolicies = new Set(["immediate", "three_months", "permanent_freeze"]);
      const requestedBanPolicy = typeof banPolicy === "string" && banPolicy.trim()
        ? banPolicy.trim().toLowerCase()
        : "permanent_freeze";
      if (targetStatus === "banned" && !allowedBanPolicies.has(requestedBanPolicy)) {
        return NextResponse.json(
          { success: false, error: "Unsupported ban withdrawal policy." },
          { status: 400 }
        );
      }

      const { data: rpcData, error: rpcError } = await supabase.rpc("admin_update_user_status_authorized", {
        p_admin_id: adminId,
        p_admin_email: adminEmail,
        p_target_user_id: userId,
        p_status: targetStatus,
        p_ban_reason: targetStatus === "banned" ? cleanReason : (cleanReason || null),
        p_ban_policy: targetStatus === "banned" ? requestedBanPolicy : null,
      });

      if (rpcError || !rpcData || rpcData.success !== true) {
        console.error("[ADMIN_USER_STATUS] Atomic status RPC failed", { code: rpcError?.code || null });
        return NextResponse.json(
          { success: false, error: "The account status change could not be completed. No changes were accepted." },
          { status: 503 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `Status updated to ${targetStatus}`,
        data: rpcData,
      });
    }

    if (action === "update_role") {
      // Prevent self-role modification to avoid privilege escalation or accidental lockout
      if (userId === adminId) {
        return NextResponse.json(
          { success: false, error: "Self-modification of administrative privileges is prohibited." },
          { status: 403 }
        );
      }

      if (role !== "admin" && role !== "user") {
        return NextResponse.json(
          { success: false, error: "Unsupported administrator role." },
          { status: 400 }
        );
      }
      const newRole = role;

      const { data: rpcData, error: rpcError } = await supabase.rpc("admin_update_user_role_authorized", {
        p_admin_id: adminId,
        p_admin_email: adminEmail,
        p_target_user_id: userId,
        p_new_role: newRole,
      });

      if (rpcError || !rpcData || rpcData.success !== true) {
        console.error("[ADMIN_USER_ROLE] Atomic role RPC failed", { code: rpcError?.code || null });
        return NextResponse.json(
          { success: false, error: "The administrator role change could not be completed. No changes were accepted." },
          { status: 503 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `Role updated to ${newRole}`,
        data: rpcData,
      });
    }

    if (action === "reset_kyc" || action === "verify_kyc" || action === "unverify_kyc") {
      const { data: kycResult, error: kycError } = await supabase.rpc(
        "admin_update_user_kyc_authorized",
        {
          p_admin_id: adminId,
          p_admin_email: adminEmail,
          p_target_user_id: userId,
          p_action: action,
        }
      );

      if (kycError || !kycResult || kycResult.success !== true || kycResult.audit_logged !== true) {
        console.error("[ADMIN_USER_KYC] Atomic KYC lifecycle RPC failed:", {
          code: kycError?.code || null,
          action,
        });
        const status = kycError?.code === "42501" ? 403
          : kycError?.code === "P0002" ? 404
          : 503;
        return NextResponse.json(
          {
            success: false,
            code: "ADMIN_KYC_ACTION_FAILED",
            error: "The KYC action and its audit record could not be completed atomically.",
          },
          { status }
        );
      }

      const message = action === "reset_kyc"
        ? "KYC verification reset. User can submit documents again."
        : action === "verify_kyc"
          ? "User KYC marked as Verified (Tier 2)."
          : "User KYC marked as Unverified (Tier 1).";

      return NextResponse.json({ success: true, message, data: kycResult });
    }

    if (action === "toggle_withdrawal") {
      if (typeof body.locked !== "boolean") {
        return NextResponse.json(
          { success: false, error: "A boolean locked value is required." },
          { status: 400 }
        );
      }

      const lock = body.locked;
      const { data: lockResult, error: lockError } = await supabase.rpc(
        "admin_set_user_withdrawal_lock_authorized",
        {
          p_admin_id: adminId,
          p_admin_email: adminEmail,
          p_target_user_id: userId,
          p_locked: lock,
        }
      );

      if (lockError || !lockResult || lockResult.success !== true || lockResult.audit_logged !== true) {
        console.error("[ADMIN_USER_WITHDRAWAL_LOCK] Atomic lock RPC failed:", {
          code: lockError?.code || null,
          locked: lock,
        });
        const status = lockError?.code === "42501" ? 403
          : lockError?.code === "P0002" ? 404
          : 503;
        return NextResponse.json(
          {
            success: false,
            code: "ADMIN_WITHDRAWAL_LOCK_FAILED",
            error: "The withdrawal lock and its audit record could not be completed atomically.",
          },
          { status }
        );
      }

      return NextResponse.json({
        success: true,
        message: lock ? "User withdrawals temporarily stopped." : "User withdrawals resumed.",
        data: lockResult,
      });
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
