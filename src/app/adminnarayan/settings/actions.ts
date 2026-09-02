"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/audit";

async function getAuthenticatedAdminId() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id || null;
}

export async function updateAppSettingsAction(formData: FormData) {
  const adminId = await getAuthenticatedAdminId();
  if (!adminId) return { success: false, error: "Unauthorized" };

  const adminSupabase = createAdminClient();

  const maintenanceMode = formData.get("maintenance_mode") === "on";
  const allowNewSignups =
    formData.get("allow_new_signups") === "on" ||
    formData.get("registrations_open") === "on";
  const platformFeePercentage =
    parseFloat(
      (formData.get("platform_fee_percentage") ||
        formData.get("platform_fee_percent")) as string
    ) || 0;
  const minTradeAmount =
    parseFloat(formData.get("min_trade_amount") as string) || 0;

  const updatedFields = {
    maintenance_mode: maintenanceMode,
    registrations_open: allowNewSignups,
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
      maintenance_mode: maintenanceMode,
      allow_new_signups: allowNewSignups,
      platform_fee_percentage: platformFeePercentage,
      min_trade_amount: minTradeAmount,
    },
  });

  revalidatePath("/adminnarayan/settings");
  return { success: true };
}
