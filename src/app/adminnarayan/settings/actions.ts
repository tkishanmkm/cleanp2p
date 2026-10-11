"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/audit";
import { setPlatformSettingKey } from "@/lib/platform-settings";

export async function updateAppSettingsAction(formData: FormData) {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    return { success: false, error: "Unauthorized: Administrator privileges required." };
  }

  const adminId = auth.adminId;
  const adminEmail = auth.adminEmail || "admin@paxones.com";
  const adminSupabase = createAdminClient();

  const platformFeePercentage =
    parseFloat(
      (formData.get("platform_fee_percentage") ||
        formData.get("platform_fee_percent")) as string
    ) || 1.5;
  const minTradeAmount =
    parseFloat(formData.get("min_trade_amount") as string) || 10.0;

  // Update fee and transaction threshold controls in app_settings
  const updatedFields = {
    platform_fee_percent: platformFeePercentage,
    min_trade_amount: minTradeAmount,
    updated_at: new Date().toISOString(),
  };

  const { error } = await adminSupabase
    .from("app_settings")
    .upsert({
      id: 1,
      ...updatedFields,
    });

  if (error) return { success: false, error: error.message };

  // Record Audit Event
  await logAdminAction({
    adminId,
    action: "UPDATE_APP_SETTINGS",
    targetId: "app_settings_1",
    details: {
      platform_fee_percentage: platformFeePercentage,
      min_trade_amount: minTradeAmount,
    },
  });

  revalidatePath("/adminnarayan/settings");
  return { success: true };
}

export async function updateWithdrawalGovernanceAction(formData: FormData) {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    return { success: false, error: "Unauthorized: Administrator privileges required." };
  }

  const adminId = auth.adminId;
  const adminEmail = auth.adminEmail || "admin@paxones.com";
  const adminSupabase = createAdminClient();

  const maxSingleUsd = parseFloat(formData.get("max_single_withdrawal_usd") as string);
  const approvalThresholdUsd = parseFloat(formData.get("withdrawal_approval_threshold_usd") as string);
  const dailyLimitUsd = parseFloat(formData.get("daily_withdrawal_limit_usd") as string);
  const passwordHoldHours = parseFloat(formData.get("password_change_withdrawal_hold_hours") as string);

  if (isNaN(maxSingleUsd) || maxSingleUsd <= 0) {
    return { success: false, error: "Maximum single withdrawal must be a positive number." };
  }
  if (isNaN(approvalThresholdUsd) || approvalThresholdUsd <= 0) {
    return { success: false, error: "Approval threshold must be a positive number." };
  }
  if (isNaN(dailyLimitUsd) || dailyLimitUsd <= 0) {
    return { success: false, error: "Daily withdrawal limit must be a positive number." };
  }
  if (isNaN(passwordHoldHours) || passwordHoldHours < 0) {
    return { success: false, error: "Password change hold duration cannot be negative." };
  }

  // Prevent nonsensical combinations
  if (approvalThresholdUsd > maxSingleUsd) {
    return { success: false, error: "Approval threshold ($" + approvalThresholdUsd + ") cannot exceed maximum single withdrawal ($" + maxSingleUsd + ")." };
  }
  if (dailyLimitUsd < maxSingleUsd) {
    return { success: false, error: "Daily withdrawal limit ($" + dailyLimitUsd + ") cannot be less than maximum single withdrawal ($" + maxSingleUsd + ")." };
  }

  const updatedFields = {
    max_single_withdrawal_usd: maxSingleUsd,
    withdrawal_approval_threshold_usd: approvalThresholdUsd,
    daily_withdrawal_limit_usd: dailyLimitUsd,
    password_change_withdrawal_hold_hours: passwordHoldHours,
    updated_at: new Date().toISOString(),
  };

  const { error } = await adminSupabase
    .from("platform_settings")
    .upsert({
      id: 1,
      ...updatedFields,
    });

  if (error) {
    return { success: false, error: error.message };
  }

  // Record Audit Event
  await logAdminAction({
    adminId,
    action: "UPDATE_WITHDRAWAL_GOVERNANCE",
    targetId: "platform_settings_1",
    details: {
      max_single_withdrawal_usd: maxSingleUsd,
      withdrawal_approval_threshold_usd: approvalThresholdUsd,
      daily_withdrawal_limit_usd: dailyLimitUsd,
      password_change_withdrawal_hold_hours: passwordHoldHours,
    },
  });

  revalidatePath("/adminnarayan/settings");
  return { success: true };
}

/** Form-action adapters intentionally return void to satisfy React's form action contract. */
export async function updateAppSettingsFormAction(formData: FormData): Promise<void> {
  await updateAppSettingsAction(formData);
}

export async function updateWithdrawalGovernanceFormAction(formData: FormData): Promise<void> {
  await updateWithdrawalGovernanceAction(formData);
}
