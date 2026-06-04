// Send a WhatsApp message via Twilio's REST API (no SDK — just a signed POST).
// Configured entirely via env vars; if any are missing it silently no-ops so it
// can never break the request that triggered it.
//   TWILIO_ACCOUNT_SID   – your Account SID
//   TWILIO_AUTH_TOKEN    – your Auth Token
//   TWILIO_WHATSAPP_FROM – the WhatsApp sender, e.g. "whatsapp:+14155238886"
//   OWNER_WHATSAPP_TO    – where alerts go, e.g. "whatsapp:+31612345678"
export async function sendWhatsApp(body: string): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  let from = process.env.TWILIO_WHATSAPP_FROM;
  let to = process.env.OWNER_WHATSAPP_TO;
  if (!sid || !token || !from || !to) return;
  // Tolerate values entered without the "whatsapp:" prefix.
  if (!from.startsWith("whatsapp:")) from = `whatsapp:${from}`;
  if (!to.startsWith("whatsapp:")) to = `whatsapp:${to}`;
  try {
    const params = new URLSearchParams({ From: from, To: to, Body: body.slice(0, 1500) });
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
