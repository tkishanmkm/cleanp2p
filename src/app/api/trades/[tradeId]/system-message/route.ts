import { NextRequest, NextResponse } from 'next/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { createClient } from '@/utils/supabase/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { buildSystemMessageDedupeKey, formatSystemMessageContent, type SystemMessagePayload } from '@/lib/trade-system-messages';

export const dynamic = 'force-dynamic';

const MAX_SYSTEM_EVENT_REQUEST_BYTES = 64 * 1024;

class SystemEventPayloadTooLargeError extends Error {
  constructor() {
    super('System event payload is too large.');
    this.name = 'SystemEventPayloadTooLargeError';
  }
}

async function readBoundedRequestText(req: Request, maxBytes: number): Promise<string> {
  if (!req.body) return '';

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
        throw new SystemEventPayloadTooLargeError();
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

const SYSTEM_EVENT_STRING_LIMITS: Record<string, number> = {
  buyerUsername: 80,
  sellerUsername: 80,
  openerUsername: 80,
  blockedUsername: 80,
  initiatorRole: 32,
  targetRole: 32,
  coinSymbol: 16,
  disputeReason: 2000,
  disputeExplanation: 4000,
  paymentMethod: 120,
  issueDetails: 6000,
  issueCategory: 120,
  feedbackComment: 500,
  customText: 12000,
  targetUserId: 80,
};

function safeTradeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!normalized || normalized.length > 80 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    const resolvedParams = await params;
    const tradeId = resolvedParams?.tradeId;

    if (!tradeId) {
      return NextResponse.json({ error: 'Trade ID is required' }, { status: 400 });
    }

    const supabase = await createClient();
    // Never authorize a privileged system-event write from a cached session
    // object. Supabase Auth must validate the current cookie JWT first.
    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData?.user;

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const declaredLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SYSTEM_EVENT_REQUEST_BYTES) {
      return NextResponse.json({ error: 'System event payload is too large.' }, { status: 413 });
    }

    let rawBody: string;
    try {
      rawBody = await readBoundedRequestText(req, MAX_SYSTEM_EVENT_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof SystemEventPayloadTooLargeError) {
        return NextResponse.json({ error: 'System event payload is too large.' }, { status: 413 });
      }
      return NextResponse.json({ error: 'A valid JSON object is required.' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'A valid JSON object is required.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A valid JSON object is required.' }, { status: 400 });
    }

    const requestBody = body as Record<string, unknown>;
    const type = requestBody.type;
    const metadataInput = requestBody.metadata === undefined ? {} : requestBody.metadata;
    const customText = requestBody.customText;
    if (!metadataInput || typeof metadataInput !== 'object' || Array.isArray(metadataInput)) {
      return NextResponse.json({ error: 'Invalid system-event metadata.' }, { status: 400 });
    }
    const metadata = metadataInput as Record<string, any>;

    for (const [field, maxLength] of Object.entries(SYSTEM_EVENT_STRING_LIMITS)) {
      const value = metadata[field];
      if (value !== undefined && value !== null &&
          (typeof value !== 'string' || value.length > maxLength)) {
        return NextResponse.json({ error: `Invalid system-event field: ${field}.` }, { status: 400 });
      }
    }
    if (metadata.coinAmount !== undefined &&
        !(typeof metadata.coinAmount === 'number' && Number.isFinite(metadata.coinAmount) ||
          typeof metadata.coinAmount === 'string' && metadata.coinAmount.length <= 64 &&
          Number.isFinite(Number(metadata.coinAmount)))) {
      return NextResponse.json({ error: 'Invalid system-event amount.' }, { status: 400 });
    }

    const allowedTypes = new Set([
      'TRADE_INITIATED', 'TRADE_STARTED', 'ESCROW_LOCKED', 'TRADE_COMPLETED', 'TRADE_RELEASED',
      'TRADE_CANCELLED', 'TRADE_EXPIRED', 'TRADE_DISPUTED', 'POSITIVE_FEEDBACK', 'NEGATIVE_FEEDBACK',
      'USER_BLOCKED', 'ISSUE_REPORTED', 'MARKED_PAID', 'MESSAGE_BLOCKED', 'SECURITY_REMINDER', 'MODERATOR_JOINED', 'CUSTOM',
    ]);
    if (typeof type !== 'string' || !allowedTypes.has(type.toUpperCase()) ||
        (customText !== undefined && customText !== null && typeof customText !== 'string') ||
        (typeof customText === 'string' && customText.length > 12000)) {
      return NextResponse.json({ error: 'Invalid system-event payload.' }, { status: 400 });
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);

    // Fetch trade record using supabaseAdmin to guarantee access
    let tradeQuery = supabaseAdmin.from('trades').select('*');
    if (isUuid) {
      tradeQuery = tradeQuery.or(`id.eq.${tradeId},trade_id.eq.${tradeId}`);
    } else {
      tradeQuery = tradeQuery.eq('trade_id', tradeId);
    }
    const { data: trade, error: tradeErr } = await tradeQuery.maybeSingle();

    if (tradeErr || !trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    // Admin-only system events use the same server authorization and signed
    // 2FA gate as other administrator actions.
    const adminAuth = await verifyServerAdmin(req);
    const isFullAdmin = adminAuth.authorized &&
      adminAuth.supportAdmin !== true &&
      adminAuth.supportReadOnly !== true;
    const isSupportAdmin = adminAuth.authorized && adminAuth.supportAdmin === true;

    const isBuyer = String(trade.buyer_id) === String(user.id);
    const isSeller = String(trade.seller_id) === String(user.id);
    const isParticipant = isBuyer || isSeller;

    if (!isFullAdmin && !isSupportAdmin && !isParticipant) {
      return NextResponse.json({ error: 'Forbidden: You are not a participant in this trade' }, { status: 403 });
    }

    const normalizedEventType = String(type).trim().toUpperCase();
    const participantEventTypes = new Set([
      'TRADE_INITIATED',
      'ISSUE_REPORTED',
      'MESSAGE_BLOCKED',
      'SECURITY_REMINDER',
    ]);
    const supportEventTypes = new Set([
      'MODERATOR_JOINED',
      'CUSTOM',
      'SECURITY_REMINDER',
    ]);

    // Status/settlement notices must never be client-authored. The canonical
    // payment/release/cancel/dispute transitions own their authoritative events.
    if (!isFullAdmin && isSupportAdmin && !supportEventTypes.has(normalizedEventType)) {
      return NextResponse.json({ error: 'Support administrators cannot publish financial or participant-authored system events.' }, { status: 403 });
    }
    if (!isFullAdmin && !isSupportAdmin && isParticipant && !participantEventTypes.has(normalizedEventType)) {
      return NextResponse.json({ error: 'This system event can only be emitted by the authoritative trade workflow.' }, { status: 403 });
    }

    const actualTradeId = trade.id || tradeId;

    // Fetch profiles for accurate usernames in system message
    let buyerUsername = '';
    let sellerUsername = '';

    const requestedBuyerName = safeTradeDisplayName(metadata.buyerUsername);
    const requestedSellerName = safeTradeDisplayName(metadata.sellerUsername);
    if (requestedBuyerName && !['buyer', 'trader'].includes(requestedBuyerName.toLowerCase())) {
      buyerUsername = requestedBuyerName;
    }
    if (requestedSellerName && !['seller', 'trader'].includes(requestedSellerName.toLowerCase())) {
      sellerUsername = requestedSellerName;
    }

    if (trade.buyer_id) {
      try {
        const { data: bp } = await supabaseAdmin
          .from('profiles')
          .select('username, display_name')
          .eq('id', trade.buyer_id)
          .maybeSingle();

        const profileName = safeTradeDisplayName(bp?.username) || safeTradeDisplayName(bp?.display_name);
        if (profileName) buyerUsername = profileName;
      } catch (bpErr: any) {
        console.warn('[System Event] buyer profile lookup failed:', bpErr?.code || 'unknown');
      }

      if (!buyerUsername) {
        try {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(trade.buyer_id);
          const candidate = safeTradeDisplayName(authUser?.user?.user_metadata?.username);
          if (candidate) buyerUsername = candidate;
        } catch {
          // Keep the non-identifying Trader fallback.
        }
      }
    }

    if (trade.seller_id) {
      try {
        const { data: sp } = await supabaseAdmin
          .from('profiles')
          .select('username, display_name')
          .eq('id', trade.seller_id)
          .maybeSingle();

        const profileName = safeTradeDisplayName(sp?.username) || safeTradeDisplayName(sp?.display_name);
        if (profileName) sellerUsername = profileName;
      } catch (spErr: any) {
        console.warn('[System Event] seller profile lookup failed:', spErr?.code || 'unknown');
      }

      if (!sellerUsername) {
        try {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(trade.seller_id);
          const candidate = safeTradeDisplayName(authUser?.user?.user_metadata?.username);
          if (candidate) sellerUsername = candidate;
        } catch {
          // Keep the non-identifying Trader fallback.
        }
      }
    }

    // Never use an email address (or arbitrary request text) as a public display name.
    buyerUsername = buyerUsername || safeTradeDisplayName(trade.buyer_username) || 'Trader';
    sellerUsername = sellerUsername || safeTradeDisplayName(trade.seller_username) || 'Trader';

    const payload: SystemMessagePayload = {
      ...metadata,
      tradeId: actualTradeId,
      type: type.toUpperCase() as SystemMessagePayload['type'],
      buyerUsername,
      sellerUsername,
      openerUsername: safeTradeDisplayName(user.user_metadata?.username) || 'Trader',
      coinAmount: trade.crypto_amount || trade.amount || metadata.coinAmount || '0.00',
      coinSymbol: trade.crypto || trade.asset_symbol || metadata.coinSymbol || 'USDT',
      paymentMethod: trade.payment_method || metadata.paymentMethod || '',
      disputeReason: metadata.disputeReason || '',
      issueDetails: metadata.issueDetails || '',
      issueCategory: metadata.issueCategory || '',
      feedbackComment: metadata.feedbackComment || '',
      customText: (isFullAdmin || isSupportAdmin) ? customText || metadata.customText : undefined,
    };

    const text = formatSystemMessageContent(payload);
    const eventType = payload.type.toUpperCase();
    const tradeStatus = String(trade.status || '').trim().toLowerCase();
    const escrowStatus = String(trade.escrow_status || '').trim().toLowerCase();

    // Transient chat instructions are returned to the browser only; they never create database or Realtime messages.
    if (eventType === 'MESSAGE_BLOCKED' || eventType === 'SECURITY_REMINDER') {
      return NextResponse.json({ success: true, localOnly: true, message: text, record: null });
    }

    const clientLifecycleTypes = new Set([
      'TRADE_INITIATED', 'TRADE_STARTED', 'ESCROW_LOCKED', 'MARKED_PAID',
      'TRADE_COMPLETED', 'TRADE_RELEASED', 'TRADE_CANCELLED', 'TRADE_EXPIRED', 'TRADE_DISPUTED',
    ]);
    if (!clientLifecycleTypes.has(eventType) && !isFullAdmin && !isSupportAdmin) {
      return NextResponse.json({ error: 'This system event can only be written by a trusted server action.' }, { status: 403 });
    }
    if ((eventType === 'CUSTOM' || eventType === 'MODERATOR_JOINED') && !isFullAdmin && !isSupportAdmin) {
      return NextResponse.json({ error: 'Administrator authorization required for this system event.' }, { status: 403 });
    }

    let stateMatches = true;
    if (['TRADE_INITIATED', 'TRADE_STARTED', 'ESCROW_LOCKED'].includes(eventType)) {
      stateMatches = !['cancelled', 'canceled', 'expired', 'completed', 'released', 'disputed'].includes(tradeStatus) &&
        (['pending', 'active', 'in_progress', 'awaiting_payment', 'pending_payment', 'escrow_locked', 'locked'].includes(tradeStatus) ||
         ['locked', 'active', 'escrow_locked'].includes(escrowStatus));
    } else if (eventType === 'MARKED_PAID') {
      stateMatches = Boolean(trade.marked_paid_at || trade.payment_confirmed_at || trade.paid_at) ||
        ['paid', 'buyer_marked_paid', 'payment_sent', 'payment_confirmed'].includes(tradeStatus) ||
        ['paid', 'payment_confirmed'].includes(escrowStatus);
    } else if (['TRADE_COMPLETED', 'TRADE_RELEASED'].includes(eventType)) {
      stateMatches = ['completed', 'released', 'complete'].includes(tradeStatus) || ['completed', 'released'].includes(escrowStatus);
    } else if (eventType === 'TRADE_CANCELLED') {
      stateMatches = ['cancelled', 'canceled'].includes(tradeStatus) || ['cancelled', 'canceled'].includes(escrowStatus);
    } else if (eventType === 'TRADE_EXPIRED') {
      stateMatches = tradeStatus === 'expired' || escrowStatus === 'expired';
    } else if (eventType === 'TRADE_DISPUTED') {
      stateMatches = tradeStatus === 'disputed' || Boolean(trade.disputed_by);
    }
    if (!stateMatches) {
      return NextResponse.json({ error: 'System event does not match the current trade state.' }, { status: 409 });
    }

    const dedupeKey = buildSystemMessageDedupeKey(actualTradeId, eventType, payload as unknown as Record<string, unknown>);
    const { data: existingEvent, error: existingError } = await supabaseAdmin
      .from('trade_system_events')
      .select('id, trade_id, sender_id, sender_username, type, message, metadata, created_at')
      .eq('trade_id', actualTradeId)
      .eq('dedupe_key', dedupeKey)
      .maybeSingle();
    if (existingError) {
      console.error('[System Event] dedupe lookup failed:', existingError.code || 'unknown');
      return NextResponse.json({ success: false, error: 'System event storage is unavailable.' }, { status: 503 });
    }
    if (existingEvent) {
      return NextResponse.json({ success: true, message: existingEvent.message, record: existingEvent, duplicate: true });
    }

    const { data: insertResult, error: insertError } = await supabaseAdmin
      .from('trade_system_events')
      .insert({
        trade_id: actualTradeId,
        sender_id: '00000000-0000-0000-0000-000000000000',
        sender_username: 'Wayones System',
        type: eventType,
        message: text,
        metadata: payload as unknown as Record<string, unknown>,
        dedupe_key: dedupeKey,
      })
      .select('id, trade_id, sender_id, sender_username, type, message, metadata, created_at')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: duplicateEvent } = await supabaseAdmin.from('trade_system_events')
          .select('id, trade_id, sender_id, sender_username, type, message, metadata, created_at')
          .eq('trade_id', actualTradeId).eq('dedupe_key', dedupeKey).maybeSingle();
        return NextResponse.json({ success: true, message: duplicateEvent?.message || text, record: duplicateEvent || null, duplicate: true });
      }
      console.error('[System Event] insert failed:', insertError.code || 'unknown');
      return NextResponse.json({ success: false, error: 'System event storage is unavailable.' }, { status: 503 });
    }

    return NextResponse.json({ success: true, message: text, record: insertResult });
  } catch (error: any) {
    console.error('[System Event] request failed:', error?.code || 'unexpected_error');
    return NextResponse.json({ error: 'System event request failed.' }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    const resolvedParams = await params;
    const tradeId = resolvedParams?.tradeId;

    if (!tradeId) {
      return NextResponse.json({ error: 'Trade ID is required' }, { status: 400 });
    }

    // System messages contain trade metadata and must only be visible to participants or admins.
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);
    let tradeQuery = supabaseAdmin.from('trades').select('id, trade_id, buyer_id, seller_id');
    tradeQuery = isUuid
      ? tradeQuery.or(`id.eq.${tradeId},trade_id.eq.${tradeId}`)
      : tradeQuery.eq('trade_id', tradeId);
    const { data: trade, error: tradeError } = await tradeQuery.maybeSingle();
    if (tradeError || !trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    const adminAuth = await verifyServerAdmin(req, { allowSupportReadOnly: true });
    const isAdmin = adminAuth.authorized && adminAuth.supportAdmin !== true && adminAuth.supportReadOnly !== true;
    const isParticipant = String(trade.buyer_id) === user.id || String(trade.seller_id) === user.id;
    if (!isAdmin && !isParticipant) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: messages, error } = await supabaseAdmin
      .from('trade_system_events')
      .select('id, trade_id, sender_id, sender_username, type, message, metadata, created_at')
      .eq('trade_id', String(trade.id))
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[System Event] read failed:', error.code || 'unknown');
      return NextResponse.json({ error: 'System event history is unavailable.' }, { status: 503 });
    }

    return NextResponse.json({ messages: messages || [] });
  } catch {
    return NextResponse.json({ error: 'System event history is unavailable.' }, { status: 500 });
  }
}
