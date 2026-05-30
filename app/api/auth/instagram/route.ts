import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const appId = process.env.INSTAGRAM_APP_ID!;
  // Use the canonical app URL from env — req.nextUrl.origin resolves to the
  // internal Vercel deployment URL behind the proxy, not the custom domain.
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://www.ordoagency.com").replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/auth/instagram/callback`;

  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_messages");
  url.searchParams.set("state", clientId);
  url.searchParams.set("response_type", "code");

  // Debug: return the URL as JSON if ?debug=1 is passed
  if (req.nextUrl.searchParams.get("debug") === "1") {
    return NextResponse.json({ redirectUri, authUrl: url.toString(), appId, appUrl });
  }

  return NextResponse.redirect(url.toString());
}
