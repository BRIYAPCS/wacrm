// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends to Meta (with phone-variant retry + contact auto-fix),
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope). Behaviour is identical to the original inline route —
// this is a straight extraction so the public endpoint can reuse it
// without duplicating ~250 lines of Meta plumbing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { resolveAccountConfig } from '@/lib/whatsapp/resolve-config';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import { wsapiSendText, wsapiSendImage, WsapiError } from '@/lib/wsapi/client';
import { wahaSendText, wahaSendImage, WahaError } from '@/lib/waha/client';
import { wahaBaseUrl } from '@/lib/waha/config';
import {
  twilioSendText,
  twilioSendMedia,
  TwilioError,
} from '@/lib/whatsapp/providers/twilio';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  replyToMessageId?: string | null;
  /**
   * The human agent who sent this, when there is one (dashboard sends).
   * Persisted to `messages.sender_id` so per-agent reporting can attribute
   * it. Leave null for automated sends (AI/away/API) — those are agent
   * messages with no specific human author and are excluded from
   * per-agent activity.
   */
  senderId?: string | null;
  /**
   * Skip the "agent stepped in → pause active flow" side effect. Set for
   * automated system sends (e.g. the away auto-reply) that route through
   * this core but are NOT a human taking over the conversation. Human
   * dashboard/API sends leave this false so pausing still happens.
   */
  suppressFlowPause?: boolean;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Meta's `wamid` for the delivered message. */
  whatsappMessageId: string;
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName } = params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    replyToMessageId,
    senderId,
    suppressFlowPause,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({ messageType, contentText, mediaUrl, templateName });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  // A group is a contact keyed by its JID (…@g.us). WAHA sends to that JID
  // directly (toChatId passes it through), so it skips E.164 validation; the
  // recipient is the JID rather than the sanitized digits.
  const isGroup = contact.is_group === true || contact.phone.endsWith('@g.us');
  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isGroup && !isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }
  const recipient = isGroup ? contact.phone : sanitizedPhone;

  // WhatsApp config — the number this conversation is on (multi-number:
  // reply from the same number the customer messaged), falling back to
  // the account default when the thread has no number yet.
  const config = await resolveAccountConfig(db, accountId, {
    preferId: conversation.whatsapp_config_id,
  });

  if (!config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  // Group chats only exist on WAHA (that's the only engine that ingests them).
  // A group conversation should never route to Meta/Twilio/WSAPI.
  if (isGroup && config.provider !== 'waha') {
    throw new SendMessageError(
      'bad_request',
      'Group chats can only be messaged from a WAHA number.',
      400
    );
  }

  // --- Provider routing: wsapi.chat numbers send via WSAPI ---------------
  // The resolved config row decides the transport. Meta rows fall through
  // to the Meta plumbing below. WSAPI rows send here and return.
  if (config.provider === 'wsapi') {
    const creds = {
      instanceId: config.wsapi_instance_id as string,
      apiKey: decrypt(config.access_token),
    };
    // Stamp the thread's number (same as the Meta path does below).
    if (!conversation.whatsapp_config_id) {
      void db
        .from('conversations')
        .update({ whatsapp_config_id: config.id })
        .eq('id', conversationId)
        .then(({ error }: { error: { message: string } | null }) => {
          if (error)
            console.warn('[send-message] stamp number failed:', error.message);
        });
    }

    let wsId: string | null = null;
    try {
      if (isMediaKind) {
        if (messageType !== 'image' || !mediaUrl) {
          throw new SendMessageError(
            'bad_request',
            'wsapi.chat numbers support text and image messages only.',
            400,
          );
        }
        wsId = (await wsapiSendImage(creds, sanitizedPhone, mediaUrl, contentText || undefined)).messageId;
      } else if (messageType === 'text') {
        wsId = (await wsapiSendText(creds, sanitizedPhone, contentText!)).messageId;
      } else {
        throw new SendMessageError(
          'bad_request',
          'wsapi.chat numbers support text and image only (templates need a Meta number).',
          400,
        );
      }
    } catch (err) {
      if (err instanceof SendMessageError) throw err;
      if (err instanceof WsapiError) {
        throw new SendMessageError('wsapi_error', err.message, err.status);
      }
      throw new SendMessageError(
        'wsapi_error',
        err instanceof Error ? err.message : 'WSAPI send failed',
        502,
      );
    }

    const { data: row, error: insErr } = await db
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_id: senderId || null,
        content_type: messageType,
        content_text: contentText || null,
        media_url: mediaUrl || null,
        message_id: wsId || `wsapi-out-${conversationId}-${Date.now()}`,
        status: 'sent',
        reply_to_message_id: replyToMessageId || null,
      })
      .select('id')
      .single();
    if (insErr || !row) {
      throw new SendMessageError(
        'db_error',
        `Sent via WSAPI but failed to save: ${insErr?.message}`,
        500,
      );
    }

    await db
      .from('conversations')
      .update({
        last_message_text: contentText || `[${messageType}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    return { messageId: row.id, whatsappMessageId: wsId || '' };
  }

  if (config.provider === 'waha') {
    const creds = {
      baseUrl: wahaBaseUrl(config.base_url),
      apiKey: decrypt(config.access_token),
      session: config.waha_session as string,
    };
    if (!conversation.whatsapp_config_id) {
      void db
        .from('conversations')
        .update({ whatsapp_config_id: config.id })
        .eq('id', conversationId)
        .then(({ error }: { error: { message: string } | null }) => {
          if (error)
            console.warn('[send-message] stamp number failed:', error.message);
        });
    }

    let wahaId: string | null = null;
    try {
      if (isMediaKind) {
        if (messageType !== 'image' || !mediaUrl) {
          throw new SendMessageError(
            'bad_request',
            'This number supports text and image messages only.',
            400,
          );
        }
        wahaId = (await wahaSendImage(creds, recipient, mediaUrl, contentText || undefined)).messageId;
      } else if (messageType === 'text') {
        wahaId = (await wahaSendText(creds, recipient, contentText!)).messageId;
      } else {
        throw new SendMessageError(
          'bad_request',
          'This number supports text and image only (templates need a Meta number).',
          400,
        );
      }
    } catch (err) {
      if (err instanceof SendMessageError) throw err;
      if (err instanceof WahaError) {
        throw new SendMessageError('waha_error', err.message, err.status);
      }
      throw new SendMessageError(
        'waha_error',
        err instanceof Error ? err.message : 'WAHA send failed',
        502,
      );
    }

    const { data: row, error: insErr } = await db
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_id: senderId || null,
        content_type: messageType,
        content_text: contentText || null,
        media_url: mediaUrl || null,
        message_id: wahaId || `waha-out-${conversationId}-${Date.now()}`,
        status: 'sent',
        reply_to_message_id: replyToMessageId || null,
      })
      .select('id')
      .single();
    if (insErr || !row) {
      throw new SendMessageError(
        'db_error',
        `Sent via WAHA but failed to save: ${insErr?.message}`,
        500,
      );
    }

    await db
      .from('conversations')
      .update({
        last_message_text: contentText || `[${messageType}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    return { messageId: row.id, whatsappMessageId: wahaId || '' };
  }

  if (config.provider === 'twilio') {
    const creds = {
      accountSid: config.provider_account_id as string,
      authToken: decrypt(config.access_token),
      from: config.phone_number as string,
    };
    if (!conversation.whatsapp_config_id) {
      void db
        .from('conversations')
        .update({ whatsapp_config_id: config.id })
        .eq('id', conversationId)
        .then(({ error }: { error: { message: string } | null }) => {
          if (error)
            console.warn('[send-message] stamp number failed:', error.message);
        });
    }

    let twId: string | null = null;
    try {
      if (isMediaKind) {
        if (!mediaUrl) {
          throw new SendMessageError('bad_request', 'Media URL required.', 400);
        }
        twId = (await twilioSendMedia(creds, sanitizedPhone, mediaUrl, contentText || undefined)).messageId;
      } else if (messageType === 'text') {
        twId = (await twilioSendText(creds, sanitizedPhone, contentText!)).messageId;
      } else {
        throw new SendMessageError(
          'bad_request',
          'Templates on Twilio use Content templates — not supported here yet.',
          400,
        );
      }
    } catch (err) {
      if (err instanceof SendMessageError) throw err;
      if (err instanceof TwilioError) {
        throw new SendMessageError('twilio_error', err.message, err.status);
      }
      throw new SendMessageError(
        'twilio_error',
        err instanceof Error ? err.message : 'Twilio send failed',
        502,
      );
    }

    const { data: row, error: insErr } = await db
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_id: senderId || null,
        content_type: messageType,
        content_text: contentText || null,
        media_url: mediaUrl || null,
        message_id: twId || `twilio-out-${conversationId}-${Date.now()}`,
        status: 'sent',
        reply_to_message_id: replyToMessageId || null,
      })
      .select('id')
      .single();
    if (insErr || !row) {
      throw new SendMessageError('db_error', `Sent via Twilio but failed to save: ${insErr?.message}`, 500);
    }

    await db
      .from('conversations')
      .update({
        last_message_text: contentText || `[${messageType}]`,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    return { messageId: row.id, whatsappMessageId: twId || '' };
  }
  // --- end provider routing ----------------------------------------------

  // Remember which number this thread went out on, so future replies (and
  // the inbox badge) stay consistent even before the next inbound.
  if (!conversation.whatsapp_config_id) {
    void db
      .from('conversations')
      .update({ whatsapp_config_id: config.id })
      .eq('id', conversationId)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] failed to stamp conversation number:',
            error.message,
          );
        }
      });
  }

  const accessToken = decrypt(config.access_token);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
  let contextMessageId: string | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no Meta message_id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
    }
  }

  // Template row (for header + button components). isMessageTemplate
  // guards against a malformed local row crashing the send-builder.
  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', templateName)
      .eq('language', templateLanguage || 'en_US')
      .maybeSingle();
    if (data && !isMessageTemplate(data)) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = data ?? null;
  }

  const attempt = async (phone: string): Promise<string> => {
    if (messageType === 'template') {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: templateName!,
        language: templateLanguage || 'en_US',
        template: templateRow ?? undefined,
        messageParams: templateMessageParams ?? undefined,
        params: templateParams || [],
        contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await sendMediaMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        kind: messageType as MediaKind,
        link: mediaUrl!,
        caption: contentText || undefined,
        filename: filename || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    const result = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: contentText!,
      contextMessageId,
    });
    return result.messageId;
  };

  // Send via Meta — retry across phone-number variants if Meta rejects
  // with "recipient not in allowed list"; persist a working variant
  // back to the contact so the next send goes straight through.
  let waMessageId = '';
  let workingPhone = sanitizedPhone;
  try {
    const variants = phoneVariants(sanitizedPhone);
    let lastError: unknown = null;

    for (const variant of variants) {
      try {
        waMessageId = await attempt(variant);
        workingPhone = variant;
        lastError = null;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isRecipientNotAllowedError(message)) {
          throw err;
        }
        lastError = err;
        console.warn(
          `[send-message] variant "${variant}" rejected by Meta, trying next…`
        );
      }
    }

    if (lastError) throw lastError;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('[send-message] Meta send failed for all variants:', message);
    throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
  }

  if (workingPhone !== sanitizedPhone) {
    console.log(
      `[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
    );
    await db
      .from('contacts')
      .update({ phone: workingPhone })
      .eq('id', contact.id);
  }

  // Persist the sent message. Field names MUST match the messages
  // schema (see 001_initial_schema.sql).
  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      // The human agent who sent it (dashboard). Null for automated agent
      // sends; per-agent reporting counts only non-null attributions.
      sender_id: senderId || null,
      content_type: messageType,
      content_text: contentText || null,
      media_url: mediaUrl || null,
      template_name: templateName || null,
      message_id: waMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort. Skipped
  // for automated system sends (the away auto-reply) that aren't a human
  // taking over.
  if (!suppressFlowPause) {
    try {
      const { error: pauseErr } = await supabaseAdmin()
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'agent_replied',
        })
        .eq('account_id', accountId)
        .eq('contact_id', contact.id)
        .eq('status', 'active');
      if (pauseErr) {
        console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
      }
    } catch (err) {
      console.error(
        '[flows] pause-on-agent-send threw:',
        err instanceof Error ? err.message : err
      );
    }
  }

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}
