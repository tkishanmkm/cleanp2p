import { getSupabaseAdminClient } from "@/lib/supabase/server";

export type NewTradeEligibility =
  | { allowed: true }
  | { allowed: false; statusCode: 403 | 503; code: string; message: string };

const BLOCKED_PROFILE_STATUSES = new Set([
  "banned",
  "restricted",
  "suspended",
  "on_hold",
  "hold",
  "frozen",
  "deleted",
  "deletion_pending",
  "blocked",
]);

const BLOCKED_ACCOUNT_STATUSES = new Set([
  "BANNED",
  "RESTRICTED",
  "SUSPENDED",
  "ON_HOLD",
  "HOLD",
  "FROZEN",
  "BLOCKED",
  "DELETION_PENDING",
  "DELETED",
  "CLOSED",
  "INACTIVE",
]);

/**
 * Server-authoritative gate for creating new trades only.
 * Existing trade actions intentionally do not use this gate so eligible active trades can finish.
 */
export async function checkNewTradeEligibility(userId: string): Promise<NewTradeEligibility> {
  if (!userId) {
    return { allowed: false, statusCode: 503, code: "ACCOUNT_STATUS_UNAVAILABLE", message: "Account eligibility could not be verified." };
  }

  const db = getSupabaseAdminClient();
  const { data: profile, error } = await db
    .from("profiles")
    .select("id, is_banned, is_restricted, is_suspended, is_minor_restricted, is_emergency_frozen, status, account_status")
    .eq("id", userId)
    .maybeSingle();

  if (error || !profile) {
    console.error("[NEW_TRADE_ELIGIBILITY] profile lookup failed:", error?.code || "profile_missing");
    return { allowed: false, statusCode: 503, code: "ACCOUNT_STATUS_UNAVAILABLE", message: "Account eligibility could not be verified. Please retry." };
  }

  const profileStatus = String(profile.status || "").trim().toLowerCase();
  const accountStatus = String(profile.account_status || "").trim().toUpperCase();
  const blocked =
    profile.is_banned === true ||
    profile.is_restricted === true ||
    profile.is_suspended === true ||
    profile.is_minor_restricted === true ||
    profile.is_emergency_frozen === true ||
    BLOCKED_PROFILE_STATUSES.has(profileStatus) ||
    BLOCKED_ACCOUNT_STATUSES.has(accountStatus) ||
    (accountStatus !== "" && accountStatus !== "ACTIVE") ||
    (accountStatus === "" && profileStatus === "");

  if (blocked) {
    return { allowed: false, statusCode: 403, code: "ACCOUNT_RESTRICTED", message: "Your account cannot initiate new trades. Existing active trades can continue." };
  }

  return { allowed: true };
}
