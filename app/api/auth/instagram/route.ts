import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const appId = process.env.INSTAGRAM_APP_ID!;
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/instagram/callback`;

  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "instagram_business_basic,instagram_business_manage_insights,instagram_business_manage_messages");
  url.searchParams.set("state", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("auth_type", "rerequest");

  return NextResponse.redirect(url.toString());
}
