import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getOrDeriveUserDepositAddresses } from "@/lib/hd-derivation-engine";

export const dynamic = "force-dynamic";

const SUPPORTED_ASSETS = new Set([
  "BTC",
  "ETH",
  "LTC",
  "USDT",
  "USDT_ERC20",
  "USDT_BEP20",
  "USDT_TRC20",
]);

async function getAuthenticatedUserId(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
      },
    });
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

/**
 * Legacy compatibility endpoint. Wallet addresses must come from the canonical
 * HD derivation service; clients may never choose the target user ID.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: "Authentication required." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const assetSymbol =
      typeof body?.assetSymbol === "string" ? body.assetSymbol.trim().toUpperCase() : "";

    if (!SUPPORTED_ASSETS.has(assetSymbol)) {
      return NextResponse.json(
        { success: false, error: "Unsupported asset symbol." },
        { status: 400 }
      );
    }

    const result = await getOrDeriveUserDepositAddresses(userId);
    const addressByAsset: Record<string, string | undefined> = {
      BTC: result.addresses.BTC,
      ETH: result.addresses.ETH,
      LTC: result.addresses.LTC,
      USDT: result.addresses.USDT_ERC20,
      USDT_ERC20: result.addresses.USDT_ERC20,
      USDT_BEP20: result.addresses.USDT_BEP20,
      USDT_TRC20: result.addresses.USDT_TRC20,
    };
    const depositAddress = addressByAsset[assetSymbol];

    if (!depositAddress) {
      return NextResponse.json(
        { success: false, error: "Deposit address is not available for this asset." },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      wallet: {
        user_id: userId,
        asset_symbol: assetSymbol,
        deposit_address: depositAddress,
        wallet_index: result.walletIndex,
      },
    });
  } catch (error) {
    console.error("[POST /api/wallet/create-address] Provisioning failed.");
    return NextResponse.json(
      { success: false, error: "Unable to provision deposit address." },
      { status: 500 }
    );
  }
}
