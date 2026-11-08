import nodemailer from "nodemailer";

const jsonHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Vary": "Origin",
};

const MAX_REQUEST_BYTES = 512 * 1024;

class PayloadTooLargeError extends Error {
  constructor() {
    super("Request payload is too large.");
    this.name = "PayloadTooLargeError";
  }
}

async function readBoundedRequestText(req: Request, maxBytes: number): Promise<string> {
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function secretsMatch(actual: string, expected: string): Promise<boolean> {
  if (!actual || !expected || actual.length > 512 || expected.length > 512) return false;

  const encoder = new TextEncoder();
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);

  // Compare fixed-size digests without an early-exit string comparison.
  const left = new Uint8Array(actualDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

function isValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length > 320) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed);
}

Deno.serve(async (req: Request) => {
  // This function is server-to-server only. Do not grant browser CORS access.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: jsonHeaders });
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

    const isAuthorized = await secretsMatch(providedSecret, expectedSecret || "");

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

    // 3. Strict Payload Validation & Byte Limits
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return new Response(
        JSON.stringify({ success: false, error: "Request payload is too large." }),
        { status: 413, headers: jsonHeaders }
      );
    }

    let rawBody: string;
    try {
      rawBody = await readBoundedRequestText(req, MAX_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return new Response(
          JSON.stringify({ success: false, error: "Request payload is too large." }),
          { status: 413, headers: jsonHeaders }
        );
      }
      return new Response(
        JSON.stringify({ success: false, error: "Invalid request payload." }),
        { status: 400, headers: jsonHeaders }
      );
    }

    let body: EmailPayload;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid JSON request payload." }),
          { status: 400, headers: jsonHeaders }
        );
      }
      body = parsed as EmailPayload;
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON request payload." }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const { to, subject, html, text } = body;

    if (typeof to !== "string" || !isValidEmail(to)) {
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

    if (text !== undefined && (typeof text !== "string" || text.length > 100000)) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid plain-text email body." }),
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
      // Require STARTTLS on non-implicit-TLS SMTP ports to prevent downgrade.
      requireTLS: !isSecure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    // 5. Send Transactional Email
    const info = await transporter.sendMail({
      from: `Wayones <${smtpFrom}>`,
      to: to.trim(),
      subject: subject.trim(),
      html: html,
      ...(text && typeof text === "string" ? { text: text.trim() } : {}),
    });

    console.log(`[send-email] Dispatch completed (Message ID: ${info.messageId})`);

    return new Response(
      JSON.stringify({
        success: true,
        messageId: info.messageId,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (err: any) {
    // 6. Safe Error Handling — do not log provider diagnostics or recipient data.
    const errorCode = typeof err?.code === "string" ? err.code.slice(0, 40) : "unknown";
    console.error("[send-email] SMTP dispatch failed (code):", errorCode);

    return new Response(
      JSON.stringify({
        success: false,
        error: "Failed to dispatch email via SMTP server.",
      }),
      { status: 500, headers: jsonHeaders }
    );
  }
});
