import { NextRequest, NextResponse } from "next/server";

// POST { clientId } — creates a Unipile hosted auth URL for Instagram
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { clientId } = body;
    if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

    const dsn    = process.env.UNIPILE_DSN;
    const key    = process.env.UNIPILE_API_KEY;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://clientflow-ten.vercel.app";

    if (!dsn || !key) {
      return NextResponse.json({ error: `Missing env: dsn=${dsn ? "ok" : "missing"} key=${key ? "ok" : "missing"}` }, { status: 500 });
    }

    const expiresOn = new Date(Date.now() + 60 * 60 * 1000).toISOString().replace(/(\.\d{3})Z$/, ".000Z");

    const res = await fetch(`https://${dsn}/api/v1/hosted/accounts/link`, {
      method: "POST",
      headers: {
        "X-API-KEY": key,
        "Content-Type": "application/json",
        "accept": "application/json",
      },
      body: JSON.stringify({
        type: "create",
        providers: ["INSTAGRAM"],
        api_url: `https://${dsn}`,
        expiresOn,
        name: String(clientId),
        success_redirect_url: `${appUrl}/api/unipile/callback?clientId=${clientId}&status=success`,
        failure_redirect_url: `${appUrl}/api/unipile/callback?clientId=${clientId}&status=failure`,
        notify_url: `${appUrl}/api/unipile/webhook`,
      }),
    });

    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data }, { status: 400 });

    return NextResponse.json({ url: data.url ?? data.hosted_url ?? data.link });
  } catch (err) {
    console.error("auth-link error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
