import { getSupabaseAdminClient as getServerAdminClient } from "./server";

/**
 * Compatibility wrapper for server-side code that expects createAdminClient.
 * The shared server helper validates the service-role key and caches the client.
 */
export function createAdminClient() {
  return getServerAdminClient();
}

export const getSupabaseAdminClient = getServerAdminClient;
