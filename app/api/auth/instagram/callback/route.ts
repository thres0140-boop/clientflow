import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get("code");
  const clientId = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !clientId) {
    return NextResponse.redirect(`${origin}/?ig_error=auth_failed`);
  }

  const appId = process.env.INSTAGRAM_APP_ID!;
  const appSecret = process.env.INSTAGRAM_APP_SECRET!;
  const redirectUri = `${origin}/api/auth/instagram/callback`;

  try {
    // 1. Exchange code for short-lived token
    const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(`No access token: ${JSON.stringify(tokenData)}`);

    const shortToken = tokenData.access_token;
    const igUserId = String(tokenData.user_id);

    // 2. Exchange for long-lived token (60 days)
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_id=${appId}&client_secret=${appSecret}&access_token=${shortToken}`
    );
    const longData = await longRes.json();
    const longToken = longData.access_token || shortToken;

    // 3. Get profile info — use id from /me as the canonical igUserId (tokenData.user_id can differ)
    const profileRes = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=id,username,followers_count&access_token=${longToken}`
    );
    const profileData = await profileRes.json();
    const canonicalUserId = profileData.id ? String(profileData.id) : igUserId;

    await prisma.instagramConnection.upsert({
      where: { clientId: parseInt(clientId) },
      create: {
        clientId: parseInt(clientId),
        accessToken: longToken,
        igUserId: canonicalUserId,
        igUsername: profileData.username || null,
        followers: profileData.followers_count || null,
      },
      update: {
        accessToken: longToken,
        igUserId: canonicalUserId,
        igUsername: profileData.username || null,
        followers: profileData.followers_count || null,
      },
    });

    return NextResponse.redirect(`${origin}/?ig_connected=1`);
  } catch (err) {
    console.error("Instagram OAuth error:", err);
    return NextResponse.redirect(`${origin}/?ig_error=server_error`);
  }
}
