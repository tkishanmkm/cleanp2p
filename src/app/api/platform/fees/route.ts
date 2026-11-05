import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPlatformFeeSettings } from "@/lib/platform-fees";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const fees = await getPlatformFeeSettings();
    return NextResponse.json({ success: true, fees }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("[Platform fees] Failed to load canonical fee settings:", error);
    return NextResponse.json(
      { error: "Platform fee settings are temporarily unavailable. Please retry." },
      { status: 503 }
    );
  }
}
