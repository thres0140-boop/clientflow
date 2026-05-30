import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const appId = process.env.INSTAGRAM_APP_ID!;
  // The redirect URI must exactly match what's registered in the Meta Instagram app.
  // It was registered as the original Vercel deployment URL — both domains hit the
  // same deployment so the callback works fine and redirects to ordoagency.com after.
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || "https://clientflow-ten.vercel.app/api/auth/instagram/callback";

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
