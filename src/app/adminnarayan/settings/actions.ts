"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/audit";

function readFormNumber(formData: FormData, key: string): number {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return Number.NaN;
  return Number(raw);
}

export async function updateAppSettingsAction(formData: FormData) {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    return { success: false, error: "Unauthorized: Administrator privileges required." };
  }

  const platformFeePercentage = readFormNumber(formData, "platform_fee_percent");
  const escrowFeePercentage = readFormNumber(formData, "escrow_fee_percent");
  const minTradeAmount = readFormNumber(formData, "min_trade_amount");

  if (!Number.isFinite(platformFeePercentage) || platformFeePercentage < 0 || platformFeePercentage > 10) {
    return { success: false, error: "Internal transfer fee must be between 0% and 10%." };
  }
  if (!Number.isFinite(escrowFeePercentage) || escrowFeePercentage < 0 || escrowFeePercentage > 10) {
    return { success: false, error: "Escrow fee must be between 0% and 10%." };
  }
  if (!Number.isFinite(minTradeAmount) || minTradeAmount <= 0 || minTradeAmount > 1000000) {
    return { success: false, error: "Minimum trade amount must be greater than zero and no more than 1,000,000." };
  }

  const adminSupabase = createAdminClient();
  const updatedAt = new Date().toISOString();
  const rows = [
    { key: "platform_fee_percent", value: String(platformFeePercentage), updated_at: updatedAt },
    { key: "escrow_fee_percent", value: String(escrowFeePercentage), updated_at: updatedAt },
    { key: "min_trade_amount", value: String(minTradeAmount), updated_at: updatedAt },
  ];

  const { error } = await adminSupabase
    .from("app_settings")
    .upsert(rows, { onConflict: "key" });

  if (error) {
    return { success: false, error: "Unable to save marketplace fee settings: " + error.message };
  }

  await logAdminAction({
    adminId: auth.adminId,
    action: "UPDATE_APP_SETTINGS",
    targetId: "app_settings",
    details: {
      platform_fee_percent: platformFeePercentage,
      escrow_fee_percent: escrowFeePercentage,
      min_trade_amount: minTradeAmount,
    },
  });

  revalidatePath("/adminnarayan/settings");
  revalidatePath("/buy");
  revalidatePath("/sell");
  return { success: true };
}

export async function updateWithdrawalGovernanceAction(formData: FormData) {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    return { success: false, error: "Unauthorized: Administrator privileges required." };
  }

  const maxSingleUsd = readFormNumber(formData, "max_single_withdrawal_usd");
  const approvalThresholdUsd = readFormNumber(formData, "withdrawal_approval_threshold_usd");
  const dailyLimitUsd = readFormNumber(formData, "daily_withdrawal_limit_usd");
  const passwordHoldHours = readFormNumber(formData, "password_change_withdrawal_hold_hours");
  const withdrawalFeeMultiplier = readFormNumber(formData, "withdrawal_fee_multiplier");

  if (!Number.isFinite(maxSingleUsd) || maxSingleUsd <= 0) {
    return { success: false, error: "Maximum single withdrawal must be a positive number." };
  }
  if (!Number.isFinite(approvalThresholdUsd) || approvalThresholdUsd <= 0) {
    return { success: false, error: "Approval threshold must be a positive number." };
  }
  if (!Number.isFinite(dailyLimitUsd) || dailyLimitUsd <= 0) {
    return { success: false, error: "Daily withdrawal limit must be a positive number." };
  }
  if (!Number.isFinite(passwordHoldHours) || passwordHoldHours < 0 || passwordHoldHours > 168) {
    return { success: false, error: "Password change hold must be between 0 and 168 hours." };
  }
  if (!Number.isFinite(withdrawalFeeMultiplier) || withdrawalFeeMultiplier < 1 || withdrawalFeeMultiplier > 10) {
    return { success: false, error: "Withdrawal gas fee multiplier must be between 1x and 10x." };
  }

  if (approvalThresholdUsd > maxSingleUsd) {
    return {
      success: false,
      error: "Approval threshold ($" + approvalThresholdUsd + ") cannot exceed maximum single withdrawal ($" + maxSingleUsd + ").",
    };
  }
  if (dailyLimitUsd < maxSingleUsd) {
    return {
      success: false,
      error: "Daily withdrawal limit ($" + dailyLimitUsd + ") cannot be less than maximum single withdrawal ($" + maxSingleUsd + ").",
    };
  }

  const adminSupabase = createAdminClient();
  const updatedFields = {
    max_single_withdrawal_usd: maxSingleUsd,
    withdrawal_approval_threshold_usd: approvalThresholdUsd,
    daily_withdrawal_limit_usd: dailyLimitUsd,
    password_change_withdrawal_hold_hours: passwordHoldHours,
    withdrawal_fee_multiplier: withdrawalFeeMultiplier,
    updated_at: new Date().toISOString(),
  };

  const { error } = await adminSupabase
    .from("platform_settings")
    .upsert({ id: 1, ...updatedFields }, { onConflict: "id" });

  if (error) {
    return { success: false, error: "Unable to save withdrawal governance settings: " + error.message };
  }

  await logAdminAction({
    adminId: auth.adminId,
    action: "UPDATE_WITHDRAWAL_GOVERNANCE",
    targetId: "platform_settings_1",
    details: updatedFields,
  });

  revalidatePath("/adminnarayan/settings");
  return { success: true };
}
