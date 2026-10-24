/**
 * Retired administrative SQL execution endpoint.
 *
 * The deployed predecessor accepted caller-supplied SQL and executed it with
 * SUPABASE_DB_URL credentials. Do not restore arbitrary SQL execution here.
 * Replace any required maintenance operation with a narrowly scoped,
 * authenticated function with fixed SQL and validated parameters.
 */
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  return new Response(
    JSON.stringify({
      success: false,
      code: "ADMIN_SQL_ENDPOINT_RETIRED",
      error: "This endpoint is retired. Use a narrowly scoped, authenticated maintenance operation.",
    }),
    { status: 410, headers },
  );
});
