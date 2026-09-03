import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdminClient();

    // 1. Fetch data in parallel
    const [
      { data: wallets, error: walletsErr },
      { data: activeTrades, error: tradesErr },
      { data: pendingWithdrawals, error: withErr },
      { data: deposits, error: depErr },
      { data: withdrawals, error: allWithErr },
      { data: adminMainWallets },
      { data: depositAddresses },
      { data: profiles },
    ] = await Promise.all([
      supabase.from("wallets").select("*"),
      supabase.from("trades").select("*").in("status", ["active", "escrow_locked", "disputed"]),
      supabase.from("withdrawals").select("*").in("status", ["pending", "queued", "approved", "broadcasting"]),
      supabase.from("deposits").select("*"),
      supabase.from("withdrawals").select("*"),
      supabase.from("admin_main_wallets").select("*"),
      supabase.from("deposit_addresses").select("*"),
      supabase.from("profiles").select("id"),
    ]);

    // 2. Determine all supported cryptocurrencies
    const supportedCurrencies = new Set<string>(["BTC", "ETH", "USDT", "LTC", "TRX"]);
    (wallets || []).forEach((w: any) => {
      if (w.currency) supportedCurrencies.add(w.currency.toUpperCase());
    });
    (adminMainWallets || []).forEach((mw: any) => {
      if (mw.currency) supportedCurrencies.add(mw.currency.toUpperCase());
    });

    const currencyList = Array.from(supportedCurrencies).sort();

    // 3. Compute System Balances (Available, Escrow, Pending Withdrawal, Total)
    const systemBalances: Record<string, {
      currency: string;
      available: number;
      escrow: number;
      pendingWithdrawal: number;
      total: number;
      userCount: number;
    }> = {};

    currencyList.forEach((c) => {
      systemBalances[c] = {
        currency: c,
        available: 0,
        escrow: 0,
        pendingWithdrawal: 0,
        total: 0,
        userCount: 0,
      };
    });

    // Sum Available balances from user wallets
    (wallets || []).forEach((w: any) => {
      const c = (w.currency || "USDT").toUpperCase();
      if (!systemBalances[c]) {
        systemBalances[c] = { currency: c, available: 0, escrow: 0, pendingWithdrawal: 0, total: 0, userCount: 0 };
      }
      const bal = parseFloat(w.balance) || 0;
      systemBalances[c].available += bal;
      if (bal > 0) systemBalances[c].userCount += 1;
    });

    // Sum Escrow from active trades
    (activeTrades || []).forEach((t: any) => {
      const c = (t.crypto || t.crypto_currency || "USDT").toUpperCase();
      if (!systemBalances[c]) {
        systemBalances[c] = { currency: c, available: 0, escrow: 0, pendingWithdrawal: 0, total: 0, userCount: 0 };
      }
      const amt = parseFloat(t.amount) || 0;
      systemBalances[c].escrow += amt;
    });

    // Sum Pending Withdrawals
    (pendingWithdrawals || []).forEach((w: any) => {
      const c = (w.crypto || "USDT").toUpperCase();
      if (!systemBalances[c]) {
        systemBalances[c] = { currency: c, available: 0, escrow: 0, pendingWithdrawal: 0, total: 0, userCount: 0 };
      }
      const amt = parseFloat(w.amount) || 0;
      systemBalances[c].pendingWithdrawal += amt;
    });

    // Total = available + escrow + pendingWithdrawal
    currencyList.forEach((c) => {
      const item = systemBalances[c];
      item.total = item.available + item.escrow + item.pendingWithdrawal;
    });

    // 4. Financial totals per cryptocurrency (Deposits and Withdrawals)
    const depositTotals: Record<string, number> = {};
    (deposits || []).forEach((d: any) => {
      const c = (d.crypto || "USDT").toUpperCase();
      depositTotals[c] = (depositTotals[c] || 0) + (parseFloat(d.amount) || 0);
    });

    const withdrawalTotals: Record<string, number> = {};
    (withdrawals || []).forEach((w: any) => {
      const c = (w.crypto || "USDT").toUpperCase();
      withdrawalTotals[c] = (withdrawalTotals[c] || 0) + (parseFloat(w.amount) || 0);
    });

    // 5. Custody / Platform Wallets
    const platformCustody: any[] = [];
    (adminMainWallets || []).forEach((mw: any) => {
      platformCustody.push({
        id: mw.id,
        currency: (mw.currency || "").toUpperCase(),
        balance: parseFloat(mw.balance) || 0,
        updated_at: mw.updated_at,
        type: "Hot Vault",
      });
    });

    // If platform custody is empty, provide dynamic records based on known keys/balances
    if (platformCustody.length === 0) {
      currencyList.forEach((c) => {
        platformCustody.push({
          id: `custody-${c.toLowerCase()}`,
          currency: c,
          balance: systemBalances[c]?.total || 0,
          updated_at: new Date().toISOString(),
          type: "System Master Reserve",
        });
      });
    }

    // 6. Operational metrics
    const totalUserWallets = (wallets || []).length;
    const totalUsers = (profiles || []).length;
    const distinctUsersWithWallets = new Set((wallets || []).map((w: any) => w.user_id)).size;
    const totalDepositAddresses = (depositAddresses || []).length;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      metrics: {
        totalUserWallets,
        totalUsers,
        distinctUsersWithWallets,
        totalDepositAddresses,
        activeTradesCount: (activeTrades || []).length,
        pendingWithdrawalsCount: (pendingWithdrawals || []).length,
      },
      systemBalances: Object.values(systemBalances),
      depositTotals,
      withdrawalTotals,
      platformCustody,
      currencies: currencyList,
    });
  } catch (err: any) {
    console.error("[API/ADMIN/WALLETS] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
