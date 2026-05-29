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

  const callbackUrl = `${APP_URL}/api/zernio/callback?clientId=${clientId}`;

  const url = new URL(`${ZERNIO_BASE}/connect/instagram`);
  url.searchParams.set("profileId", PROFILE_ID);
  url.searchParams.set("redirect_url", callbackUrl);

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

  // Zernio returns { authUrl: "https://..." } — redirect the user there
  const redirectTarget = data.authUrl ?? data.url ?? data.connect_url ?? data.auth_url;
  if (!redirectTarget) {
    return NextResponse.json({ error: "No connect URL returned", raw: data }, { status: 500 });
  }

  return NextResponse.redirect(redirectTarget);
}
