import { getSupabaseAdminClient } from '@/utils/supabase/server';

export interface NewTradeEmailPayload {
  tradeId: string;
  publicId: string;
  sellerId: string;
  buyerId: string;
  cryptoAmount: number | string;
  fiatAmount: number | string;
  fiatCurrency: string;
  asset: string;
  price: number | string;
  paymentMethod: string;
  status?: string;
  createdAt?: string | Date;
}

export interface TradeEmailResult {
  recipient: string;
  role: 'buyer' | 'seller';
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Escapes dynamic string values to prevent HTML injection/XSS in email clients.
 */
function escapeHtml(input: any): string {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str.replace(/[&<>"']/g, (m) => {
    switch (m) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#039;';
      default:
        return m;
    }
  });
}

/**
 * Formats a date explicitly into human-readable UTC representation:
 * Example: "30 Sep 2026, 10:20:00 UTC"
 */
function formatUtcDate(dateInput: string | Date | undefined): string {
  if (!dateInput) return formatUtcDate(new Date());
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return formatUtcDate(new Date());

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  const secs = String(d.getUTCSeconds()).padStart(2, '0');

  return `${day} ${month} ${year}, ${hours}:${mins}:${secs} UTC`;
}

/**
 * Formats user profile usernames cleanly with `@` prefix.
 */
function formatUsername(name: string, fallback: string): string {
  const trimmed = name?.trim();
  if (!trimmed || trimmed === fallback) return fallback;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function buildTradeEmailPlainText(params: {
  recipientRole: 'buyer' | 'seller';
  tradeId: string;
  publicId: string;
  buyerUsername: string;
  sellerUsername: string;
  formattedCrypto: string;
  formattedAsset: string;
  formattedFiat: string;
  formattedFiatCurrency: string;
  formattedPrice: string;
  paymentMethod: string;
  dateFormattedUtc: string;
  tradeUrl: string;
}): string {
  const {
    recipientRole,
    tradeId,
    publicId,
    buyerUsername,
    sellerUsername,
    formattedCrypto,
    formattedAsset,
    formattedFiat,
    formattedFiatCurrency,
    formattedPrice,
    paymentMethod,
    dateFormattedUtc,
    tradeUrl,
  } = params;

  const displayRefId = publicId || tradeId;
  const roleText =
    recipientRole === 'buyer'
      ? 'Your P2P trade request has been successfully initiated on Paxones. The crypto asset is safely locked in escrow.'
      : 'A new P2P trade request has been initiated with you on Paxones. The crypto asset is safely locked in escrow.';

  return `
New P2P Trade Initiated — Paxones

${roleText}

Trade Details:
----------------------------------------
Trade ID:       ${displayRefId}
Buyer:          ${buyerUsername}
Seller:         ${sellerUsername}
Asset:          ${formattedCrypto} ${formattedAsset}
Fiat Amount:    ${formattedFiat} ${formattedFiatCurrency}
Exchange Rate:  ${formattedPrice} ${formattedFiatCurrency} / ${formattedAsset}
Payment Method: ${paymentMethod || 'Bank Transfer'}
Created (UTC):  ${dateFormattedUtc}

View and manage your trade securely on Paxones:
${tradeUrl}

Security Notice:
Never share your password, private keys, seed phrase, or 2FA codes with anyone.
If you didn't initiate or expect this trade, please review your account and contact support@paxones.com.

© 2026 Paxones. Secure Peer-to-Peer Crypto Marketplace.
`.trim();
}

function buildTradeEmailHtml(params: {
  recipientRole: 'buyer' | 'seller';
  tradeId: string;
  publicId: string;
  buyerUsername: string;
  sellerUsername: string;
  formattedCrypto: string;
  formattedAsset: string;
  formattedFiat: string;
  formattedFiatCurrency: string;
  formattedPrice: string;
  paymentMethod: string;
  dateFormattedUtc: string;
  tradeUrl: string;
}): string {
  const {
    recipientRole,
    tradeId,
    publicId,
    buyerUsername,
    sellerUsername,
    formattedCrypto,
    formattedAsset,
    formattedFiat,
    formattedFiatCurrency,
    formattedPrice,
    paymentMethod,
    dateFormattedUtc,
    tradeUrl,
  } = params;

  const subtitle =
    recipientRole === 'buyer'
      ? 'Your P2P trade request has been successfully initiated on Paxones. The crypto asset is safely locked in escrow.'
      : 'A new P2P trade request has been initiated with you on Paxones. The crypto asset is safely locked in escrow.';

  const displayRefId = escapeHtml(publicId || tradeId);
  const displayBuyer = escapeHtml(buyerUsername);
  const displaySeller = escapeHtml(sellerUsername);
  const displayCrypto = escapeHtml(formattedCrypto);
  const displayAsset = escapeHtml(formattedAsset);
  const displayFiat = escapeHtml(formattedFiat);
  const displayCurrency = escapeHtml(formattedFiatCurrency);
  const displayPrice = escapeHtml(formattedPrice);
  const displayPayment = escapeHtml(paymentMethod || 'Bank Transfer');
  const displayUtcDate = escapeHtml(dateFormattedUtc);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New P2P Trade Initiated</title>
</head>
<body style="margin: 0; padding: 0; background-color: #07090e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #e2e8f0;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #07090e; width: 100%; padding: 40px 10px;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #0f1423; border: 1px solid #1e2640; border-radius: 16px; overflow: hidden; padding: 32px 24px; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);">
          
          <!-- Header Card / Logo -->
          <tr>
            <td align="center" style="padding-bottom: 24px; background: linear-gradient(180deg, #131b31 0%, #0f1423 100%); padding-top: 12px; border-radius: 12px;">
              <img src="https://eaiwgfxoiwxepinvcykg.supabase.co/storage/v1/object/public/public-assets/paxones%20win.png" alt="Paxones Logo" width="160" style="display: block; width: 160px; max-width: 100%; height: auto; border: 0;" />
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td align="center" style="padding-top: 16px; padding-bottom: 12px;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.3px;">New P2P Trade Initiated</h1>
            </td>
          </tr>

          <!-- Subtitle -->
          <tr>
            <td align="center" style="padding-bottom: 28px;">
              <p style="margin: 0; font-size: 14px; color: #94a3b8; line-height: 1.5;">${subtitle}</p>
            </td>
          </tr>

          <!-- Trade Details Table Card -->
          <tr>
            <td style="padding-bottom: 28px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #161c2e; border: 1px solid #232d47; border-radius: 12px; padding: 20px;">
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; color: #94a3b8;">Trade ID</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; font-weight: 600; color: #ffffff; font-family: monospace;">${displayRefId}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; color: #94a3b8;">Buyer</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; font-weight: 600; color: #ffffff;">${displayBuyer}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; color: #94a3b8;">Seller</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; font-weight: 600; color: #ffffff;">${displaySeller}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; color: #94a3b8;">Asset</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; font-weight: 600; color: #a78bfa;">${displayAsset}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; color: #94a3b8;">Amount</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; font-weight: 600; color: #e2e8f0;">${displayCrypto} ${displayAsset}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; color: #94a3b8;">Fiat Amount</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; font-weight: 700; color: #34d399;">${displayFiat} ${displayCurrency}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; color: #94a3b8;">Exchange Rate</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; color: #e2e8f0;">${displayPrice} ${displayCurrency} / ${displayAsset}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; color: #94a3b8;">Payment Method</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid #232d47; font-size: 13px; color: #e2e8f0;">${displayPayment}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; font-size: 12px; color: #64748b;">Created (UTC)</td>
                  <td align="right" style="padding: 10px 0; font-size: 12px; color: #94a3b8; font-weight: 500;">${displayUtcDate}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Primary CTA Button -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <a href="${tradeUrl}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); background-color: #7c3aed; color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 36px; border-radius: 8px; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4);">
                View Trade
              </a>
            </td>
          </tr>

          <!-- Security & Notice Footer -->
          <tr>
            <td style="padding: 16px; background-color: #121829; border: 1px solid #1e293b; border-radius: 8px; font-size: 12px; color: #94a3b8; line-height: 1.5;">
              <p style="margin: 0 0 6px 0;"><strong style="color: #f87171;">Security Notice:</strong> Never share your password, private keys, seed phrase, or 2FA codes with anyone.</p>
              <p style="margin: 0;">If you didn't initiate or expect this trade, please review your account and contact support.</p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 28px; border-top: 1px solid #1e2640; font-size: 12px; color: #64748b; line-height: 1.6;">
              <p style="margin: 0 0 6px 0;">Need help? Contact <a href="mailto:support@paxones.com" style="color: #a78bfa; text-decoration: none;">support@paxones.com</a></p>
              <p style="margin: 0;">&copy; 2026 Paxones. Secure Peer-to-Peer Crypto Marketplace.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

export async function sendNewTradeNotificationEmail(
  payload: NewTradeEmailPayload
): Promise<{ success: boolean; results: TradeEmailResult[]; error?: string }> {
  const results: TradeEmailResult[] = [];

  try {
    const {
      tradeId,
      publicId,
      sellerId,
      buyerId,
      cryptoAmount,
      fiatAmount,
      fiatCurrency,
      asset,
      price,
      paymentMethod,
      createdAt = new Date(),
    } = payload;

    const adminClient = getSupabaseAdminClient();

    // 1. Fetch Seller's and Buyer's Auth & Profile Data concurrently
    const [sellerUserRes, buyerUserRes, sellerProfileRes, buyerProfileRes] =
      await Promise.all([
        sellerId ? adminClient.auth.admin.getUserById(sellerId) : Promise.resolve({ data: null, error: null }),
        buyerId ? adminClient.auth.admin.getUserById(buyerId) : Promise.resolve({ data: null, error: null }),
        sellerId
          ? adminClient
              .from('profiles')
              .select('username')
              .eq('id', sellerId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        buyerId
          ? adminClient
              .from('profiles')
              .select('username')
              .eq('id', buyerId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);

    const sellerEmail = sellerUserRes?.data?.user?.email?.trim() || '';
    const buyerEmail = buyerUserRes?.data?.user?.email?.trim() || '';

    const rawSellerUsername =
      sellerProfileRes?.data?.username?.trim() ||
      'Seller';

    const rawBuyerUsername =
      buyerProfileRes?.data?.username?.trim() ||
      'Buyer';

    const sellerUsername = formatUsername(rawSellerUsername, 'Seller');
    const buyerUsername = formatUsername(rawBuyerUsername, 'Buyer');

    // 2. Construct Canonical Authenticated Trade URL
    // The production URL MUST always resolve to https://paxones.com/trade/{canonicalPublicTradeId}
    // Strictly prevent development / AI Studio / localhost internal preview hostnames from leaking into customer emails
    const configuredSiteUrl = (
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.SITE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      'https://paxones.com'
    ).trim().replace(/\/$/, '');

    const isInternalPreview = /ais-|aistudio|google\.com|run\.app|localhost|127\.0\.0\.1/i.test(configuredSiteUrl);
    const baseSiteUrl = isInternalPreview ? 'https://paxones.com' : (configuredSiteUrl || 'https://paxones.com');
    const canonicalPublicTradeId = String(publicId || tradeId);
    const tradeUrl = `${baseSiteUrl}/trade/${encodeURIComponent(canonicalPublicTradeId)}`;

    // Format numbers
    const formattedCrypto = Number(cryptoAmount || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 8,
    });
    const formattedFiat = Number(fiatAmount || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const formattedPrice = Number(price || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
    const formattedAsset = String(asset || 'USDT').toUpperCase();
    const formattedFiatCurrency = String(fiatCurrency || 'USD').toUpperCase();
    const dateFormattedUtc = formatUtcDate(createdAt);

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      'https://eaiwgfxoiwxepinvcykg.supabase.co';
    const edgeFunctionUrl = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/send-email`;
    const emailAuthSecret = process.env.EMAIL_FUNCTION_AUTH_SECRET;

    if (!emailAuthSecret) {
      console.warn('[tradeEmailService] EMAIL_FUNCTION_AUTH_SECRET is not configured on server.');
      return {
        success: false,
        results: [],
        error: 'EMAIL_FUNCTION_AUTH_SECRET not configured',
      };
    }

    // 3. Build Recipient Dispatches (Deduplicating identical emails if buyer and seller have same email)
    const targets: Array<{ email: string; role: 'buyer' | 'seller' }> = [];

    if (buyerEmail) {
      targets.push({ email: buyerEmail, role: 'buyer' });
    }

    if (sellerEmail) {
      const isDuplicate = targets.some(
        (t) => t.email.toLowerCase() === sellerEmail.toLowerCase()
      );
      if (!isDuplicate) {
        targets.push({ email: sellerEmail, role: 'seller' });
      } else {
        console.log(
          `[tradeEmailService] Buyer and Seller share email address (${sellerEmail}). Sending single notification.`
        );
      }
    }

    if (targets.length === 0) {
      console.warn('[tradeEmailService] No valid buyer or seller email addresses found for trade:', tradeId);
      return { success: false, results: [], error: 'No recipient email addresses found' };
    }

    // 4. Dispatch Email to Each Target Non-Blocking & Isolated
    for (const target of targets) {
      try {
        const html = buildTradeEmailHtml({
          recipientRole: target.role,
          tradeId,
          publicId,
          buyerUsername,
          sellerUsername,
          formattedCrypto,
          formattedAsset,
          formattedFiat,
          formattedFiatCurrency,
          formattedPrice,
          paymentMethod,
          dateFormattedUtc,
          tradeUrl,
        });

        const plainText = buildTradeEmailPlainText({
          recipientRole: target.role,
          tradeId,
          publicId,
          buyerUsername,
          sellerUsername,
          formattedCrypto,
          formattedAsset,
          formattedFiat,
          formattedFiatCurrency,
          formattedPrice,
          paymentMethod,
          dateFormattedUtc,
          tradeUrl,
        });

        const response = await fetch(edgeFunctionUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Email-Function-Secret': emailAuthSecret,
          },
          body: JSON.stringify({
            to: target.email,
            subject: `Paxones P2P Trade Initiated — ${publicId || tradeId}`,
            html,
            text: plainText,
          }),
        });

        const resData = await response.json().catch(() => ({}));

        if (!response.ok || !resData.success) {
          console.error(
            `[tradeEmailService] Failed to dispatch email to ${target.role} (${target.email}):`,
            response.status,
            resData
          );
          results.push({
            recipient: target.email,
            role: target.role,
            success: false,
            error: resData.error || `HTTP ${response.status}`,
          });
        } else {
          console.log(
            `[tradeEmailService] Success: Trade initiation email sent to ${target.role} (${target.email}) for trade ${publicId || tradeId} (Message ID: ${resData.messageId})`
          );
          results.push({
            recipient: target.email,
            role: target.role,
            success: true,
            messageId: resData.messageId,
          });
        }
      } catch (dispatchErr: any) {
        console.error(
          `[tradeEmailService] Exception dispatching email to ${target.role} (${target.email}):`,
          dispatchErr?.message || dispatchErr
        );
        results.push({
          recipient: target.email,
          role: target.role,
          success: false,
          error: dispatchErr?.message || 'Dispatch exception',
        });
      }
    }

    const anySuccess = results.some((r) => r.success);
    return { success: anySuccess, results };
  } catch (err: any) {
    console.error(
      '[tradeEmailService] Unexpected error in sendNewTradeNotificationEmail:',
      err?.message || err
    );
    return { success: false, results, error: err?.message || 'Unknown error' };
  }
}
