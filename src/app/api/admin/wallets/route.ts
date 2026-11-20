import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { normalizePrimaryWalletAssetBalance } from "@/lib/wallet-balance-normalization";
import { fetchAllSupabaseRows } from "@/lib/supabase/fetch-all-pages";

export const dynamic = "force-dynamic";

const PAGE_OPTIONS = { pageSize: 1000, maxRows: 20000 };

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req, { allowSupportReadOnly: true });
    if (!auth.authorized) return auth.response!;
    if (auth.supportAdmin === true || auth.supportReadOnly === true) {
      return NextResponse.json(
        { success: false, error: "Full administrator access is required to view platform-wide wallet and custody data." },
        { status: 403 }
      );
    }

    const supabase = getSupabaseAdminClient();

    // Read complete bounded result sets. Supabase's default REST row limit can
    // silently truncate aggregate totals, so every query is paginated and its
    // exact count is returned to the caller.
    const [
      walletAssetsResult,
      activeTradesResult,
      pendingWithdrawalsResult,
      depositsResult,
      withdrawalsResult,
      adminMainWalletsResult,
      depositAddressesResult,
      profilesResult,
    ] = await Promise.all([
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("wallet_assets")
          .select("user_id,asset_symbol,balance,locked_balance,reserved_balance,in_escrow,in_withdrawal", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("trades")
          .select("id", { count: "exact" })
          .in("escrow_status", ["escrow_locked", "in_escrow", "locked", "held", "disputed"])
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("onchain_withdrawals")
          .select("id", { count: "exact" })
          .in("status", ["PENDING", "PENDING_APPROVAL", "NEEDS_APPROVAL", "QUEUED", "APPROVED", "BROADCASTED", "RECOVERY_REQUIRED"])
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("deposits")
          .select("asset,token_symbol,amount", { count: "exact" })
          .in("status", ["CONFIRMED", "confirmed", "COMPLETED", "completed", "CREDITED", "credited"])
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("onchain_withdrawals")
          .select("asset_symbol,amount,status", { count: "exact" })
          .in("status", ["BROADCASTED", "COMPLETED", "CONFIRMED", "RECOVERY_REQUIRED"])
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("admin_main_wallets")
          .select("*", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("deposit_addresses")
          .select("id", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("profiles")
          .select("id", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
    ]);

    const allResults = [
      walletAssetsResult,
      activeTradesResult,
      pendingWithdrawalsResult,
      depositsResult,
      withdrawalsResult,
      adminMainWalletsResult,
      depositAddressesResult,
      profilesResult,
    ];
    const failed = allResults.find((result) => result.error || result.truncated);
    if (failed) {
      console.error("[API/ADMIN/WALLETS] An authoritative query failed or exceeded the safe history cap.");
      return NextResponse.json(
        {
          success: false,
          error: "Platform wallet metrics could not be fully verified. Reduce history or complete reconciliation before relying on these totals.",
          code: failed.error ? "FINANCIAL_READ_FAILED" : "FINANCIAL_HISTORY_TRUNCATED",
        },
        { status: 503 }
      );
    }

    const walletAssets = walletAssetsResult.rows;
    const activeTrades = activeTradesResult.rows;
    const pendingWithdrawals = pendingWithdrawalsResult.rows;
    const deposits = depositsResult.rows;
    const withdrawals = withdrawalsResult.rows;
    const adminMainWallets = adminMainWalletsResult.rows;
    const depositAddresses = depositAddressesResult.rows;
    const profiles = profilesResult.rows;

    // 1. Determine the supported assets from canonical wallet records and
    // actual custody records, never by inventing reserve rows from customer balances.
    const supportedCurrencies = new Set<string>(["BTC", "ETH", "USDT", "LTC", "TRX"]);
    for (const wallet of walletAssets) {
      const currency = String(wallet.asset_symbol || "").trim().toUpperCase();
      if (currency) supportedCurrencies.add(currency);
    }
    for (const custody of adminMainWallets) {
      const currency = String(custody.currency || "").trim().toUpperCase();
      if (currency) supportedCurrencies.add(currency);
    }

    const currencyList = Array.from(supportedCurrencies).sort();
    const systemBalances: Record<string, {
      currency: string;
      available: number;
      reserved: number;
      escrow: number;
      pendingWithdrawal: number;
      total: number;
      userCount: number;
    }> = {};

    for (const currency of currencyList) {
      systemBalances[currency] = {
        currency,
        available: 0,
        reserved: 0,
        escrow: 0,
        pendingWithdrawal: 0,
        total: 0,
        userCount: 0,
      };
    }

    // balance is already spendable after the financial RPCs move funds into
    // escrow/withdrawal buckets. Add those buckets exactly once.
    for (const wallet of walletAssets) {
      const currency = String(wallet.asset_symbol || "").trim().toUpperCase();
      if (!currency) {
        return NextResponse.json({ success: false, error: "A wallet asset has no currency code; reconciliation is required." }, { status: 503 });
      }
      if (!systemBalances[currency]) {
        systemBalances[currency] = { currency, available: 0, reserved: 0, escrow: 0, pendingWithdrawal: 0, total: 0, userCount: 0 };
      }

      const numericValues = [
        wallet.balance,
        wallet.locked_balance,
        wallet.reserved_balance,
        wallet.in_escrow,
        wallet.in_withdrawal,
      ];
      if (numericValues.some((value) =>
        value !== null && value !== undefined &&
        (!Number.isFinite(Number(value)) || Number(value) < 0)
      )) {
        return NextResponse.json({ success: false, error: "Invalid canonical wallet liability row; manual reconciliation required." }, { status: 503 });
      }

      const normalized = normalizePrimaryWalletAssetBalance(wallet);
      if (!normalized.accountingValid) {
        return NextResponse.json(
          { success: false, error: "Wallet reserve mirror mismatch; reconciliation is required." },
          { status: 503 }
        );
      }
      systemBalances[currency].available += normalized.available;
      systemBalances[currency].reserved += normalized.reserved;
      systemBalances[currency].escrow += normalized.inEscrow;
      systemBalances[currency].pendingWithdrawal += normalized.inWithdrawal;
      if (normalized.total > 0) systemBalances[currency].userCount += 1;
    }

    for (const currency of Object.keys(systemBalances)) {
      const item = systemBalances[currency];
      item.total = item.available + item.reserved + item.escrow + item.pendingWithdrawal;
    }

    // These history totals are informational only. Customer spendable balance
    // continues to come exclusively from wallet_assets, not deposit/withdrawal sums.
    const depositTotals: Record<string, number> = {};
    for (const deposit of deposits) {
      const currency = String(deposit.asset || deposit.token_symbol || "USDT").trim().toUpperCase();
      const amount = Number(deposit.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return NextResponse.json({ success: false, error: "Invalid confirmed deposit amount in wallet report." }, { status: 503 });
      }
      depositTotals[currency] = (depositTotals[currency] || 0) + amount;
    }

    const withdrawalTotals: Record<string, number> = {};
    const totalDeposits = {
      totalCount: 0,
      byCurrency: {} as Record<string, { count: number; volume: number }>,
    };
    for (const deposit of deposits) {
      const currency = String(deposit.asset || deposit.token_symbol || "USDT").trim().toUpperCase();
      const amount = Number(deposit.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return NextResponse.json({ success: false, error: "Invalid confirmed deposit amount in wallet report." }, { status: 503 });
      }
      const entry = totalDeposits.byCurrency[currency] || { count: 0, volume: 0 };
      entry.count += 1;
      entry.volume += amount;
      totalDeposits.byCurrency[currency] = entry;
      totalDeposits.totalCount += 1;
    }

    const totalWithdrawals = {
      totalCount: 0,
      byCurrency: {} as Record<string, { count: number; volume: number }>,
    };
    for (const withdrawal of withdrawals) {
      const currency = String(withdrawal.asset_symbol || "USDT").trim().toUpperCase();
      const amount = Number(withdrawal.amount);
      if (!Number.isFinite(amount) || amount < 0) {
        return NextResponse.json({ success: false, error: "Invalid on-chain withdrawal amount in wallet report." }, { status: 503 });
      }
      withdrawalTotals[currency] = (withdrawalTotals[currency] || 0) + amount;
      const entry = totalWithdrawals.byCurrency[currency] || { count: 0, volume: 0 };
      entry.count += 1;
      entry.volume += amount;
      totalWithdrawals.byCurrency[currency] = entry;
      totalWithdrawals.totalCount += 1;
    }

    const platformCustody = adminMainWallets.map((wallet: any) => ({
      id: wallet.id,
      currency: String(wallet.currency || "").toUpperCase(),
      balance: Number(wallet.balance || 0),
      updated_at: wallet.updated_at,
      type: "Admin Main Wallet Balance Snapshot",
    }));

    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        metrics: {
          totalUserWallets: walletAssets.length,
          totalUsers: profiles.length,
          distinctUsersWithWallets: new Set(walletAssets.map((wallet: any) => wallet.user_id)).size,
          totalDepositAddresses: depositAddresses.length,
          activeTradesCount: activeTrades.length,
          pendingWithdrawalsCount: pendingWithdrawals.length,
        },
        systemBalances: Object.values(systemBalances),
        depositTotals,
        withdrawalTotals,
        totalDeposits,
        totalWithdrawals,
        platformCustody,
        custodyAvailable: platformCustody.length > 0,
        financialHistoryTruncated: false,
        currencies: Object.keys(systemBalances).sort(),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error: unknown) {
    console.error("[API/ADMIN/WALLETS] Error:", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json(
      { success: false, error: "Platform wallet metrics could not be loaded." },
      { status: 500 }
    );
  }
}
