// Send a WhatsApp message via Twilio's REST API (no SDK — just a signed POST).
// Configured entirely via env vars; if any are missing it silently no-ops so it
// can never break the request that triggered it.
//   TWILIO_ACCOUNT_SID          – your Account SID
//   TWILIO_AUTH_TOKEN           – your Auth Token
//   TWILIO_WHATSAPP_FROM        – the WhatsApp sender, e.g. "whatsapp:+31970..."
//   OWNER_WHATSAPP_TO           – where alerts go, e.g. "whatsapp:+31612345678"
//   TWILIO_WHATSAPP_CONTENT_SID – (production) approved template SID "HX…" whose body is
//                                 "…{{1}}". When set, alerts are sent as that template so
//                                 they deliver even outside WhatsApp's 24h window. Without
//                                 it we fall back to a plain Body (sandbox / in-window only).

// WhatsApp template variables can't contain newlines, tabs, or long space runs — flatten.
export function flattenForTemplate(s: string): string {
  return s.replace(/\s*\n\s*/g, " · ").replace(/\t/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 1000);
}

export async function sendWhatsApp(body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  let from = process.env.TWILIO_WHATSAPP_FROM;
  let to = process.env.OWNER_WHATSAPP_TO;
  const contentSid = process.env.TWILIO_WHATSAPP_CONTENT_SID;
  if (!sid || !token || !from || !to) return;
  // Tolerate values entered without the "whatsapp:" prefix.
  if (!from.startsWith("whatsapp:")) from = `whatsapp:${from}`;
  if (!to.startsWith("whatsapp:")) to = `whatsapp:${to}`;
  try {
    const params = new URLSearchParams({ From: from, To: to });
    if (contentSid) {
      // Business-initiated → must use an approved template to deliver outside the 24h window.
      params.set("ContentSid", contentSid);
      params.set("ContentVariables", JSON.stringify({ "1": flattenForTemplate(body) }));
    } else {
      params.set("Body", body.slice(0, 1500));
    }
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
  } catch { /* non-fatal — never block the triggering action */ }
}
