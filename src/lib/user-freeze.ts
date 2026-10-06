import { getSupabaseAdminClient } from "@/lib/supabase/server";

export class UserEmergencyFrozenError extends Error {
  public readonly code = "USER_EMERGENCY_FROZEN";
  public readonly statusCode = 403;

  constructor(message = "Your account is under an emergency security freeze. Financial operations are temporarily blocked.") {
    super(message);
    this.name = "UserEmergencyFrozenError";
  }
}

/**
 * Authoritatively verifies whether a user account is under an emergency security freeze.
 * Queries public.profiles.is_emergency_frozen using the service role admin client.
 * Throws UserEmergencyFrozenError if the user is frozen.
 */
export async function assertUserNotEmergencyFrozen(userId: string): Promise<void> {
  if (!userId) return;

  try {
    const admin = getSupabaseAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("is_emergency_frozen")
      .eq("id", userId)
      .maybeSingle();

    if (profile && profile.is_emergency_frozen === true) {
      throw new UserEmergencyFrozenError();
    }
  } catch (err) {
    if (err instanceof UserEmergencyFrozenError) throw err;
    console.warn("[assertUserNotEmergencyFrozen] Warning verifying freeze state:", err);
  }
}
