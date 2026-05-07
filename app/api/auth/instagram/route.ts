import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const appId = process.env.META_APP_ID!;
  const origin = req.nextUrl.origin;
  const redirectUri = `${origin}/api/auth/instagram/callback`;

  const url = new URL("https://www.facebook.com/v19.0/dialog/oauth");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "instagram_basic,pages_show_list,pages_read_engagement,business_management");
  url.searchParams.set("state", clientId);
  url.searchParams.set("response_type", "code");

  return NextResponse.redirect(url.toString());
}
