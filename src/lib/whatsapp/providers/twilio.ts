// ============================================================
// Twilio WhatsApp adapter. Send via the Twilio Messages REST API:
//   POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
//   Basic auth: SID : AuthToken
//   form body: To=whatsapp:+…, From=whatsapp:+…, Body=…, MediaUrl=…
// ============================================================

export interface TwilioCreds {
  accountSid: string;
  authToken: string;
  /** The WhatsApp sender, E.164 (e.g. "+14155238886"). */
  from: string;
}

export class TwilioError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TwilioError";
  }
}

const waAddr = (n: string) =>
  n.startsWith("whatsapp:") ? n : `whatsapp:${n.startsWith("+") ? n : `+${n.replace(/[^\d]/g, "")}`}`;

async function post(
  creds: TwilioCreds,
  form: Record<string, string>,
): Promise<{ messageId: string | null }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`;
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new TwilioError(err instanceof Error ? err.message : "Twilio request failed", 502);
  }
  const json = (await res.json().catch(() => null)) as
    | { sid?: string; message?: string; code?: number }
    | null;
  if (!res.ok) {
    throw new TwilioError(json?.message ?? `Twilio HTTP ${res.status}`, res.status);
  }
  return { messageId: json?.sid ?? null };
}

export function twilioSendText(creds: TwilioCreds, to: string, text: string) {
  return post(creds, { To: waAddr(to), From: waAddr(creds.from), Body: text });
}

export function twilioSendMedia(
  creds: TwilioCreds,
  to: string,
  mediaUrl: string,
  caption?: string,
) {
  const form: Record<string, string> = {
    To: waAddr(to),
    From: waAddr(creds.from),
    MediaUrl: mediaUrl,
  };
  if (caption) form.Body = caption;
  return post(creds, form);
}
