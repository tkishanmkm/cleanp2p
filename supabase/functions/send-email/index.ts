import nodemailer from "nodemailer";

const jsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-email-function-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

function isValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length > 320) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed);
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: jsonHeaders });
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method Not Allowed. Expected POST." }),
      { status: 405, headers: jsonHeaders }
    );
  }

  try {
    // 1. Dedicated Function Secret Authorization Verification
    const secretHeader = (
      req.headers.get("x-email-function-secret") ||
      req.headers.get("X-Email-Function-Secret") ||
      ""
    ).trim();

    const authHeader = (
      req.headers.get("authorization") ||
      req.headers.get("Authorization") ||
      ""
    ).trim();

    let providedSecret = secretHeader;
    if (!providedSecret && authHeader.startsWith("Bearer ")) {
      providedSecret = authHeader.substring(7).trim();
    }

    const expectedSecret = Deno.env.get("EMAIL_FUNCTION_AUTH_SECRET")?.trim();

    const isAuthorized = Boolean(
      expectedSecret &&
      providedSecret &&
      providedSecret === expectedSecret
    );

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ success: false, error: "Forbidden." }),
        { status: 403, headers: jsonHeaders }
      );
    }

    // 2. Strict Environment Secrets Validation (Zero defaults allowed)
    const smtpHost = Deno.env.get("SMTP_HOST")?.trim();
    const smtpPortRaw = Deno.env.get("SMTP_PORT")?.trim();
    const smtpUser = Deno.env.get("SMTP_USER")?.trim();
    const smtpPassword = Deno.env.get("SMTP_PASSWORD")?.trim();
    const smtpFrom = Deno.env.get("SMTP_FROM")?.trim();

    if (!smtpHost || !smtpPortRaw || !smtpUser || !smtpPassword || !smtpFrom) {
      console.error("[send-email] Server Configuration Error: One or more required SMTP environment secrets are missing.");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Server configuration error: Required SMTP environment secrets are not configured.",
        }),
        { status: 500, headers: jsonHeaders }
      );
    }

    const smtpPort = parseInt(smtpPortRaw, 10);
    if (isNaN(smtpPort) || smtpPort <= 0 || smtpPort > 65535) {
      console.error("[send-email] Server Configuration Error: Invalid SMTP_PORT value.");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Server configuration error: Invalid SMTP port configuration.",
        }),
        { status: 500, headers: jsonHeaders }
      );
    }

    // 3. Strict Payload Validation & Length Limits
    let body: EmailPayload;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON request payload." }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const { to, subject, html } = body;

    if (!to || !isValidEmail(to)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid or missing 'to' recipient email address. Must be a valid email (max 320 chars).",
        }),
        { status: 400, headers: jsonHeaders }
      );
    }

    if (!subject || typeof subject !== "string" || !subject.trim() || subject.trim().length > 200) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid or missing 'subject'. Subject must be a non-empty string under 200 characters.",
        }),
        { status: 400, headers: jsonHeaders }
      );
    }

    if (!html || typeof html !== "string" || !html.trim() || html.trim().length > 100000) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid or missing 'html' content. HTML payload must be a non-empty string under 100,000 characters.",
        }),
        { status: 400, headers: jsonHeaders }
      );
    }

    // 4. Configure Secure Hostinger SMTP Transporter
    const isSecure = smtpPort === 465;

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: isSecure,
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
      tls: {
        rejectUnauthorized: true,
      },
    });

    // 5. Send Transactional Email
    const info = await transporter.sendMail({
      from: `Paxones <${smtpFrom}>`,
      to: to.trim(),
      subject: subject.trim(),
      html: html,
    });

    console.log(`[send-email] Success: Email dispatched to ${to.trim()} (Message ID: ${info.messageId})`);

    return new Response(
      JSON.stringify({
        success: true,
        messageId: info.messageId,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (err: any) {
    // 6. Safe Error Handling — Sanitize output, log server-side diagnostic, return generic client error
    const rawError = err?.message || String(err) || "Unknown error";
    // Sanitize any credential occurrences in logs
    const sanitizedLog = rawError.replace(/pass=.*?(?=\s|$)/gi, "pass=***");
    console.error("[send-email] SMTP Dispatch Failure:", sanitizedLog);

    return new Response(
      JSON.stringify({
        success: false,
        error: "Failed to dispatch email via SMTP server.",
      }),
      { status: 500, headers: jsonHeaders }
    );
  }
});
