import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { fetchAllSupabaseRows } from "@/lib/supabase/fetch-all-pages";
import { normalizePrimaryWalletAssetBalance } from "@/lib/wallet-balance-normalization";

export const dynamic = "force-dynamic";

const PAGE_OPTIONS = { pageSize: 1000, maxRows: 20000 };

function depositIdentity(row: any, source: "onchain" | "legacy"): string {
  const tx = String(row.tx_hash || row.txid || "").trim().toLowerCase();
  if (!tx) return source + ":" + String(row.id || "");
  const network = String(row.network || row.network_code || row.chain || "").trim().toUpperCase();
  const outputIndex = Number.isSafeInteger(Number(row.output_index)) ? Number(row.output_index) : 0;
  return [network, tx, String(outputIndex)].join(":");
}

function withdrawalIdentity(row: any, source: "onchain" | "legacy"): string {
  const tx = String(row.tx_hash || row.txid || "").trim().toLowerCase();
  if (!tx) return source + ":" + String(row.id || "");
  const network = String(row.network || row.network_code || row.chain || "").trim().toUpperCase();
  return network + ":" + tx;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) return auth.response!;
    if (auth.supportAdmin === true || auth.supportReadOnly === true) {
      return NextResponse.json(
        { success: false, error: "Full administrator access is required for platform-wide user and wallet records.", users: [] },
        { status: 403 }
      );
    }

    const supabase = getSupabaseAdminClient();
    const { searchParams } = new URL(req.url);
    const query = (searchParams.get("q") || "").trim().toLowerCase();

    const [
      profilesResult,
      walletAssetsResult,
      legacyDepositsResult,
      onchainDepositsResult,
      legacyWithdrawalsResult,
      onchainWithdrawalsResult,
      tradesResult,
      adsResult,
      legacyAdsResult,
      disputesResult,
    ] = await Promise.all([
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("profiles")
          .select("id, username, display_name, full_name, email, role, is_admin, is_admin_account, status, is_banned, is_suspended, is_on_hold, is_restricted, is_minor_restricted, is_emergency_frozen, account_status, created_at, updated_at, completed_trades, total_completed_trades, trade_volume, total_volume_usd, feedback_score, positive_feedback, negative_feedback, avatar_url, photo_url, is_online, last_seen, last_seen_at, country, preferred_currency, kyc_status, is_verified, id_verified, merchant_tier, merchant_status, ban_reason, banned_at", { count: "exact" })
          .order("created_at", { ascending: false })
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("wallet_assets")
          .select("user_id,asset_symbol,balance,locked_balance,reserved_balance,in_escrow,in_withdrawal", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("deposits")
          .select("id,user_id,chain,token_symbol,tx_hash,amount,to_address,status,block_number,asset,output_index,created_at", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("onchain_deposits")
          .select("id,user_id,tx_hash,txid,network,network_code,address,to_address,amount,asset_symbol,asset_code,asset,output_index,confirmations,required_confirmations,status,created_at,updated_at", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("withdrawals")
          .select("id,user_id,chain,token_symbol,amount,tx_hash,txid,status,asset,asset_code,asset_symbol,network,network_code,created_at", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("onchain_withdrawals")
          .select("id,user_id,network,amount,tx_hash,status,asset_symbol,created_at", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("trades")
          .select("id,trade_id,buyer_id,seller_id,crypto,crypto_currency,asset_code,amount,crypto_amount,status,created_at", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("ads")
          .select("id,user_id,public_id,public_ad_id,asset_symbol,type,is_active,status,is_deleted,created_at", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("advertisements")
          .select("id,user_id,public_id,crypto_currency,type,is_active,created_at", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
      fetchAllSupabaseRows<any>(
        (from, to) => supabase.from("disputes")
          .select("id,trade_id,opened_by_id,status,created_at", { count: "exact" })
          .range(from, to),
        PAGE_OPTIONS
      ),
    ]);

    const results = [
      profilesResult, walletAssetsResult, legacyDepositsResult, onchainDepositsResult,
      legacyWithdrawalsResult, onchainWithdrawalsResult, tradesResult,
      adsResult, legacyAdsResult, disputesResult,
    ];
    const incomplete = results.find((result) => result.error || result.truncated);
    if (incomplete) {
      console.error("[API/ADMIN/USERS] A paginated user/financial query failed or exceeded the safe cap.");
      return NextResponse.json(
        { success: false, error: "Platform user and financial records could not be fully verified.", users: [] },
        { status: 503 }
      );
    }

    const profiles = profilesResult.rows;
    const walletAssets = walletAssetsResult.rows;
    const trades = tradesResult.rows;
    const disputes = disputesResult.rows;

    // Prefer canonical on-chain rows and retain legacy records only when the
    // network + tx hash + log/output identity is not already represented.
    const depositsByIdentity = new Map<string, any>();
    for (const row of onchainDepositsResult.rows) {
      depositsByIdentity.set(depositIdentity(row, "onchain"), row);
    }
    for (const row of legacyDepositsResult.rows) {
      const key = depositIdentity(row, "legacy");
      if (!depositsByIdentity.has(key)) depositsByIdentity.set(key, row);
    }

    const withdrawalsByIdentity = new Map<string, any>();
    for (const row of onchainWithdrawalsResult.rows) {
      withdrawalsByIdentity.set(withdrawalIdentity(row, "onchain"), row);
    }
    for (const row of legacyWithdrawalsResult.rows) {
      const key = withdrawalIdentity(row, "legacy");
      if (!withdrawalsByIdentity.has(key)) withdrawalsByIdentity.set(key, row);
    }

    const adsByIdentity = new Map<string, any>();
    for (const row of adsResult.rows) {
      const key = String(row.public_ad_id || row.public_id || row.id);
      adsByIdentity.set(key, row);
    }
    for (const row of legacyAdsResult.rows) {
      const key = String(row.public_id || row.id);
      if (!adsByIdentity.has(key)) adsByIdentity.set(key, row);
    }
    const ads = Array.from(adsByIdentity.values());

    // Never present an unverified user wallet bucket set in a platform user report.
    if (walletAssets.some((wallet: any) =>
      !normalizePrimaryWalletAssetBalance(wallet).accountingValid
    )) {
      return NextResponse.json(
        { success: false, error: "Wallet accounting buckets require reconciliation before user financial reports can be displayed.", users: [] },
        { status: 503 }
      );
    }

    // Normalize canonical wallet buckets without merging their meanings;
    // balance is spendable, while reserve/escrow/withdrawal remain separate.
    const walletMap = new Map<string, any[]>();
    for (const wallet of walletAssets) {
      if (!walletMap.has(wallet.user_id)) walletMap.set(wallet.user_id, []);
      const normalized = normalizePrimaryWalletAssetBalance(wallet);
      walletMap.get(wallet.user_id)!.push({
        currency: String(wallet.asset_symbol || "USDT").toUpperCase(),
        balance: normalized.available,
        total_balance: normalized.total,
        reserved_balance: normalized.reserved,
        locked_balance: normalized.reserved,
        reserved_total: normalized.reserved + normalized.inEscrow + normalized.inWithdrawal,
        in_escrow: normalized.inEscrow,
        in_withdrawal: normalized.inWithdrawal,
      });
    }

    // Sum only deposits confirmed/credited by the canonical chain-confirmation
    // process. Pending, failed and rejected candidates are never shown as deposits.
    const depositTotalsMap = new Map<string, Record<string, number>>();
    const depositRows = Array.from(depositsByIdentity.values());
    for (const deposit of depositRows) {
      const status = String(deposit.status || "").trim().toLowerCase();
      if (!["confirmed", "completed", "credited"].includes(status)) continue;

      const userId = deposit.user_id;
      const currency = String(deposit.asset_symbol || deposit.asset_code || deposit.token_symbol || deposit.asset || "USDT").trim().toUpperCase();
      const amount = Number(deposit.amount);
      if (!userId || !Number.isFinite(amount) || amount < 0) {
        return NextResponse.json(
          { success: false, error: "A deposit history record failed validation.", users: [] },
          { status: 503 }
        );
      }
      if (!depositTotalsMap.has(userId)) depositTotalsMap.set(userId, {});
      const totals = depositTotalsMap.get(userId)!;
      totals[currency] = (totals[currency] || 0) + amount;
    }

    const withdrawalTotalsMap = new Map<string, Record<string, number>>();
    for (const withdrawal of withdrawalsByIdentity.values()) {
      const userId = withdrawal.user_id;
      const currency = String(withdrawal.asset_symbol || withdrawal.asset_code || withdrawal.token_symbol || withdrawal.asset || "USDT").trim().toUpperCase();
      const amount = Number(withdrawal.amount);
      if (!userId || !Number.isFinite(amount) || amount < 0) {
        return NextResponse.json(
          { success: false, error: "A withdrawal history record failed validation.", users: [] },
          { status: 503 }
        );
      }
      if (!withdrawalTotalsMap.has(userId)) withdrawalTotalsMap.set(userId, {});
      const totals = withdrawalTotalsMap.get(userId)!;
      totals[currency] = (totals[currency] || 0) + amount;
    }

    const tradeCountsMap = new Map<string, { total: number; completed: number; active: number }>();
    for (const trade of trades) {
      const status = String(trade.status || "").trim().toLowerCase();
      for (const userId of [trade.buyer_id, trade.seller_id].filter(Boolean)) {
        if (!tradeCountsMap.has(userId)) tradeCountsMap.set(userId, { total: 0, completed: 0, active: 0 });
        const counts = tradeCountsMap.get(userId)!;
        counts.total += 1;
        if (["completed", "released"].includes(status)) counts.completed += 1;
        if (["active", "created", "escrow_locked", "paid", "payment_sent", "buyer_marked_paid", "disputed"].includes(status)) counts.active += 1;
      }
    }

    const adsCountMap = new Map<string, { total: number; active: number }>();
    for (const ad of ads) {
      const userId = ad.user_id;
      if (!adsCountMap.has(userId)) adsCountMap.set(userId, { total: 0, active: 0 });
      const counts = adsCountMap.get(userId)!;
      counts.total += 1;
      const status = String(ad.status || "").trim().toUpperCase();
      if (ad.is_active === true && ad.is_deleted !== true && (!status || status === "ACTIVE")) counts.active += 1;
    }

    const disputesCountMap = new Map<string, number>();
    for (const dispute of disputes) {
      const userId = dispute.opened_by_id;
      if (userId) disputesCountMap.set(userId, (disputesCountMap.get(userId) || 0) + 1);
    }

    const matchedUserIdsFromAssociatedEntities = new Set<string>();
    if (query) {
      for (const trade of trades) {
        if (String(trade.id).toLowerCase().includes(query) || String(trade.trade_id || "").toLowerCase().includes(query)) {
          if (trade.buyer_id) matchedUserIdsFromAssociatedEntities.add(trade.buyer_id);
          if (trade.seller_id) matchedUserIdsFromAssociatedEntities.add(trade.seller_id);
        }
      }
      for (const deposit of depositRows) {
        if (String(deposit.id).toLowerCase().includes(query) || String(deposit.tx_hash || deposit.txid || "").toLowerCase().includes(query)) {
          if (deposit.user_id) matchedUserIdsFromAssociatedEntities.add(deposit.user_id);
        }
      }
      for (const withdrawal of withdrawalsByIdentity.values()) {
        if (String(withdrawal.id).toLowerCase().includes(query) || String(withdrawal.tx_hash || withdrawal.txid || "").toLowerCase().includes(query)) {
          if (withdrawal.user_id) matchedUserIdsFromAssociatedEntities.add(withdrawal.user_id);
        }
      }
      for (const ad of ads) {
        if (String(ad.id).toLowerCase().includes(query) || String(ad.public_id || ad.public_ad_id || "").toLowerCase().includes(query)) {
          if (ad.user_id) matchedUserIdsFromAssociatedEntities.add(ad.user_id);
        }
      }
    }

    const combinedUsers = profiles.map((profile: any) => {
      const userWallets = walletMap.get(profile.id) || [];
      const balanceMap: Record<string, number> = {};
      for (const wallet of userWallets) {
        const currency = String(wallet.currency || "USDT").toUpperCase();
        balanceMap[currency] = (balanceMap[currency] || 0) + Number(wallet.balance || 0);
      }

      return {
        ...profile,
        status: profile.status || (profile.is_banned ? "Banned" : profile.is_suspended ? "Suspended" : "Active"),
        wallets: userWallets,
        balances: balanceMap,
        depositTotals: depositTotalsMap.get(profile.id) || {},
        withdrawalTotals: withdrawalTotalsMap.get(profile.id) || {},
        tradeCounts: tradeCountsMap.get(profile.id) || { total: profile.completed_trades || 0, completed: profile.completed_trades || 0, active: 0 },
        adsCount: adsCountMap.get(profile.id) || { total: 0, active: 0 },
        disputesCount: disputesCountMap.get(profile.id) || 0,
      };
    });

    const filteredUsers = query
      ? combinedUsers.filter((user: any) => {
          const idMatch = String(user.id || "").toLowerCase().includes(query);
          const usernameMatch = String(user.username || "").toLowerCase().includes(query);
          const nameMatch = String(user.full_name || "").toLowerCase().includes(query);
          const emailMatch = String(user.email || "").toLowerCase().includes(query);
          const roleMatch = String(user.role || "").toLowerCase().includes(query);
          const statusMatch = String(user.status || "").toLowerCase().includes(query);
          return idMatch || usernameMatch || nameMatch || emailMatch || roleMatch || statusMatch ||
            matchedUserIdsFromAssociatedEntities.has(user.id);
        })
      : combinedUsers;

    return NextResponse.json(
      {
        success: true,
        users: filteredUsers,
        totalCount: combinedUsers.length,
        filteredCount: filteredUsers.length,
        historyTruncated: false,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error: unknown) {
    console.error("[API/ADMIN/USERS] Internal error:", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json(
      { success: false, error: "Administrator user records could not be loaded.", users: [] },
      { status: 500 }
    );
  }
}
