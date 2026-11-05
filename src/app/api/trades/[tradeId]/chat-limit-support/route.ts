import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const SUPPORT_EMAIL = 'support@paxones.com';

async function sendSupportEmail(to: string, subject: string, text: string): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const emailAuthSecret = process.env.EMAIL_FUNCTION_AUTH_SECRET;
  if (!supabaseUrl || !emailAuthSecret) {
    console.error('[chat-limit-support] Email dispatch is not configured.');
    return false;
  }
  try {
    const baseUrl = supabaseUrl.endsWith('/') ? supabaseUrl.slice(0, -1) : supabaseUrl;
    const response = await fetch(`${baseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Email-Function-Secret': emailAuthSecret },
      body: JSON.stringify({ to, subject, text, html: `<pre>${text.replace(/[&<>]/g, (ch) => ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;')}</pre>` }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.success !== true) {
      console.error('[chat-limit-support] Email dispatch failed:', response.status);
      return false;
    }
    return true;
  } catch {
    console.error('[chat-limit-support] Email dispatch threw an error.');
    return false;
  }
}

export async function POST(request: Request, context: { params: Promise<{ tradeId: string }> }) {
  try {
    const { tradeId: rawTradeId } = await context.params;
    const tradeId = String(rawTradeId || '').trim();
    if (!tradeId || tradeId.length > 128) return NextResponse.json({ error: 'Invalid trade ID.' }, { status: 400 });

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 4096) {
      return NextResponse.json({ error: 'Support request is too large.' }, { status: 413 });
    }
    const rawBody = await request.text();
    if (rawBody.length > 4096) return NextResponse.json({ error: 'Support request is too large.' }, { status: 413 });
    let body: { reason?: unknown } = {};
    if (rawBody.trim()) {
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return NextResponse.json({ error: 'Invalid support request body.' }, { status: 400 });
        }
        body = parsed as { reason?: unknown };
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
      }
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length > 1000) return NextResponse.json({ error: 'Support details must be 1000 characters or fewer.' }, { status: 400 });

    const authClient = await createClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    let { data: trade, error: tradeError } = await admin.from('trades').select('id,trade_id,buyer_id,seller_id').eq('id', tradeId).maybeSingle();
    if (!trade && !tradeError) {
      const result = await admin.from('trades').select('id,trade_id,buyer_id,seller_id').eq('trade_id', tradeId).maybeSingle();
      trade = result.data;
      tradeError = result.error;
    }
    if (tradeError) {
      console.error('[chat-limit-support] Trade lookup failed:', tradeError.message);
      return NextResponse.json({ error: 'Could not verify this trade. Please try again.' }, { status: 503 });
    }
    if (!trade) return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });
    if (![String(trade.buyer_id || ''), String(trade.seller_id || '')].includes(user.id)) {
      return NextResponse.json({ error: 'Only trade participants can request chat-limit support.' }, { status: 403 });
    }

    const { data: reservation, error: reserveError } = await admin.from('trade_chat_limit_requests').insert({
      trade_id: String(trade.id), user_id: user.id, status: 'creating',
    }).select('id,support_ticket_id').single();

    if (reserveError) {
      if (reserveError.code === '23505') {
        const { data: existing, error: existingError } = await admin.from('trade_chat_limit_requests')
          .select('id,support_ticket_id,status,email_status').eq('trade_id', String(trade.id)).eq('user_id', user.id).maybeSingle();
        if (existingError) return NextResponse.json({ error: 'Could not confirm your support request. Please try again.' }, { status: 503 });
        if (existing?.support_ticket_id) {
          let emailSent = existing.email_status === 'sent';
          if (!emailSent) {
            const retryText = [
              'Trade chat message limit reached (100 messages per participant per trade).',
              `Trade ID: ${String(trade.trade_id || trade.id)}`,
              `Support ticket ID: ${existing.support_ticket_id}`,
              `User ID: ${user.id}`,
              `User email: ${user.email || '(not available)'}`,
              `User details: ${reason || 'User requested moderator assistance after reaching the chat limit.'}`,
            ].join(String.fromCharCode(10));
            emailSent = await sendSupportEmail(SUPPORT_EMAIL, `[Paxones Support] Trade chat limit reached — ${String(trade.trade_id || trade.id)}`, retryText);
            await admin.from('trade_chat_limit_requests').update({ email_status: emailSent ? 'sent' : 'failed', updated_at: new Date().toISOString() }).eq('id', existing.id);
          }
          return NextResponse.json({ success: true, alreadySubmitted: true, emailSent, message: emailSent ? 'A support request is recorded and the moderation team has been emailed.' : `Support request is recorded, but email delivery could not be confirmed. Please contact ${SUPPORT_EMAIL} with the trade ID.` });
        }
        return NextResponse.json({ error: 'Your support request is being processed. Please retry shortly.' }, { status: 409 });
      }
      console.error('[chat-limit-support] Reservation failed:', reserveError.message);
      return NextResponse.json({ error: 'Support request could not be recorded.' }, { status: 503 });
    }

    const publicTradeId = String(trade.trade_id || trade.id);
    const ticketMessage = [
      'Trade chat message limit reached (100 messages per participant per trade).',
      `Trade ID: ${publicTradeId}`,
      `User ID: ${user.id}`,
      `Contact: ${SUPPORT_EMAIL}`,
      reason ? `User details: ${reason}` : 'User requested moderator assistance after reaching the chat limit.',
    ].join('\n');
    const { data: ticket, error: ticketError } = await admin.from('support_tickets').insert([{
      user_id: user.id, email: user.email || '', message: ticketMessage, status: 'Open', created_at: new Date().toISOString(),
    }]).select('id').single();

    if (ticketError || !ticket) {
      await admin.from('trade_chat_limit_requests').delete().eq('id', reservation.id);
      console.error('[chat-limit-support] Ticket creation failed:', ticketError?.message || 'No ticket returned');
      return NextResponse.json({ error: `Support ticket could not be created. Please contact ${SUPPORT_EMAIL} with the trade ID.` }, { status: 503 });
    }

    const { error: linkError } = await admin.from('trade_chat_limit_requests')
      .update({ support_ticket_id: String(ticket.id), status: 'submitted', updated_at: new Date().toISOString() }).eq('id', reservation.id);
    if (linkError) console.error('[chat-limit-support] Ticket recorded but idempotency link failed:', linkError.message);

    const emailText = [
      ticketMessage,
      `Support ticket ID: ${ticket.id}`,
      `User email: ${user.email || '(not available)'}`,
      `Requested at: ${new Date().toISOString()}`,
    ].join('\n');
    const emailSent = await sendSupportEmail(
      SUPPORT_EMAIL,
      `[Paxones Support] Trade chat limit reached — ${publicTradeId}`,
      emailText,
    );
    const { error: emailStatusError } = await admin.from('trade_chat_limit_requests')
      .update({ email_status: emailSent ? 'sent' : 'failed', updated_at: new Date().toISOString() })
      .eq('id', reservation.id);
    if (emailStatusError) console.error('[chat-limit-support] Email status update failed:', emailStatusError.message);

    return NextResponse.json({
      success: true,
      alreadySubmitted: false,
      emailSent,
      message: emailSent
        ? 'Support request recorded and emailed to the moderation team.'
        : `Support request recorded, but email delivery could not be confirmed. Please contact ${SUPPORT_EMAIL} with the trade ID.`,
    }, { status: 201 });
  } catch (error) {
    console.error('[chat-limit-support] Unexpected failure:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: `Support request could not be recorded. Please contact ${SUPPORT_EMAIL} with the trade ID.` }, { status: 500 });
  }
}
