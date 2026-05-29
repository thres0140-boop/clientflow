import { NextRequest, NextResponse } from "next/server";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.ZERNIO_PROFILE_ID!;
const APP_URL     = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.ordoagency.com";

// GET /api/zernio/connect?clientId=X
// Redirects the user to the Zernio-hosted Instagram OAuth page.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  // Do NOT pass redirect_url — Zernio uses it as Instagram's redirect_uri,
  // and only their own registered URL is whitelisted in their Meta App.
  // Without it, Zernio uses their own callback which works fine.
  const url = new URL(`${ZERNIO_BASE}/connect/instagram`);
  url.searchParams.set("profileId", PROFILE_ID);

  // Fetch the connect URL from Zernio
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${ZERNIO_KEY}`,
      Accept: "application/json",
    },
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json({ error: data }, { status: 400 });
  }

  // Return the authUrl as JSON — the frontend opens it in a new tab
  // (We can't redirect there directly because we're not passing a redirect_url,
  // so after OAuth the user ends up on Zernio's dashboard, not back in our app.)
  const authUrl = data.authUrl ?? data.url ?? data.connect_url ?? data.auth_url;
  if (!authUrl) {
    return NextResponse.json({ error: "No connect URL returned", raw: data }, { status: 500 });
  }

  return NextResponse.json({ authUrl });
}
