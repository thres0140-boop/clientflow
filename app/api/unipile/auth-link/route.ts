import { NextRequest, NextResponse } from "next/server";

const BASE = `https://${process.env.UNIPILE_DSN}/api/v1`;
const KEY  = process.env.UNIPILE_API_KEY!;

// POST { clientId } — creates a Unipile hosted auth URL for Instagram
export async function POST(req: NextRequest) {
  const { clientId } = await req.json();
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://clientflow-ten.vercel.app";

  // Link expires in 1 hour
  const expiresOn = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace(/(\.\d{3})Z$/, ".000Z");

  const res = await fetch(`${BASE}/hosted/accounts/link`, {
    method: "POST",
    headers: {
      "X-API-KEY": KEY,
      "Content-Type": "application/json",
      "accept": "application/json",
    },
    body: JSON.stringify({
      type: "create",
      providers: ["INSTAGRAM"],
      api_url: `https://${process.env.UNIPILE_DSN}`,
      expiresOn,
      name: String(clientId),
      success_redirect_url: `${appUrl}/api/unipile/callback?clientId=${clientId}&status=success`,
      failure_redirect_url: `${appUrl}/api/unipile/callback?clientId=${clientId}&status=failure`,
      notify_url: `${appUrl}/api/unipile/webhook`,
    }),
  });

  const data = await res.json();
  if (!res.ok) return NextResponse.json({ error: data }, { status: 400 });

  // Unipile returns { url: "https://..." }
  return NextResponse.json({ url: data.url ?? data.hosted_url ?? data.link });
}
