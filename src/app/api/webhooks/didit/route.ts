import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// In-memory fallback for idempotency
const inMemoryProcessedEvents = new Set<string>();

function shortenFloats(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shortenFloats);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        k,
        shortenFloats(x),
      ])
    );
  }
  if (typeof v === "number" && !Number.isInteger(v) && v % 1 === 0) {
    return Math.trunc(v);
  }
  return v;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v as object)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return v;
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const sig = req.headers.get("x-signature-v2") ?? "";
    const ts = Number(req.headers.get("x-timestamp"));

    // 1. Freshness check
    if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) {
      return new Response("stale timestamp", { status: 401 });
    }

    // 2. Canonicalization
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    const canonical = JSON.stringify(sortKeys(shortenFloats(parsed)));

    // 3. HMAC Verification
    const secret = process.env.DIDIT_WEBHOOK_SECRET;
    if (!secret) {
      console.error("DIDIT_WEBHOOK_SECRET is not configured");
      return new Response("server misconfigured", { status: 500 });
    }

    const expected = crypto
      .createHmac("sha256", secret)
      .update(canonical, "utf8")
      .digest("hex");

    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
    ) {
      return new Response("invalid signature", { status: 401 });
    }

    // 4. Idempotency check with Supabase (with in-memory fallback)
    const eventId = parsed.event_id;
    if (eventId) {
      if (inMemoryProcessedEvents.has(eventId)) {
        return new Response("already processed", { status: 200 });
      }

      try {
        const { data: existingEvent } = await supabaseAdmin
          .from("webhook_events")
          .select("event_id")
          .eq("event_id", eventId)
          .maybeSingle();

        if (existingEvent) {
          inMemoryProcessedEvents.add(eventId);
          return new Response("already processed", { status: 200 });
        }

        await supabaseAdmin.from("webhook_events").insert({ event_id: eventId });
      } catch (dbErr) {
        console.warn("webhook_events lookup or insert note:", dbErr);
      }

      inMemoryProcessedEvents.add(eventId);
      if (inMemoryProcessedEvents.size > 5000) {
        const first = inMemoryProcessedEvents.values().next().value;
        if (first) inMemoryProcessedEvents.delete(first);
      }
    }

    // 5. Update user state
    const userId = parsed.vendor_data;

    switch (parsed.status) {
      case "Approved":
        await supabaseAdmin
          .from("profiles")
          .update({
            kyc_status: "APPROVED",
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
        break;

      case "Declined":
      case "Resubmitted": {
        // Execute atomic RPC procedure
        let rpcSuccess = false;
        try {
          const { error: rpcError } = await supabaseAdmin.rpc("record_kyc_failure", {
            p_user_id: userId,
            p_status: "RESUBMIT",
            p_session_id: parsed.session_id,
            p_decision_reason: JSON.stringify(parsed.decision ?? null),
            p_nodes_to_resubmit: parsed.resubmit_info?.nodes_to_resubmit ?? null,
          });

          if (!rpcError) {
            rpcSuccess = true;
          } else {
            console.warn("record_kyc_failure RPC error, falling back:", rpcError.message);
          }
        } catch (rpcErr) {
          console.warn("RPC call threw, falling back to direct table update:", rpcErr);
        }

        // Fallback update if RPC is not available in database
        if (!rpcSuccess && userId) {
          try {
            const { data: userProfile } = await supabaseAdmin
              .from("profiles")
              .select("kyc_attempts")
              .eq("id", userId)
              .single();

            const currentAttempts = (userProfile?.kyc_attempts as number) || 0;
            const newAttempts = currentAttempts + 1;
            const newStatus = newAttempts >= 3 ? "SUPPORT_REQUIRED" : "RESUBMIT";

            await supabaseAdmin
              .from("profiles")
              .update({
                kyc_attempts: newAttempts,
                kyc_status: newStatus,
                updated_at: new Date().toISOString(),
              })
              .eq("id", userId);
          } catch (profileErr) {
            console.error("Failed to update user profile in fallback:", profileErr);
          }
        }
        break;
      }

      case "In Review":
        await supabaseAdmin
          .from("profiles")
          .update({
            kyc_status: "PENDING_REVIEW",
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
        break;

      case "Kyc Expired":
        await supabaseAdmin
          .from("profiles")
          .update({
            kyc_status: "EXPIRED",
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
        break;

      default:
        break;
    }

    return new Response("ok", { status: 200 });
  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return new Response("error", { status: 500 });
  }
}
