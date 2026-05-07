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

  const appId = process.env.META_APP_ID!;
  const appSecret = process.env.META_APP_SECRET!;
  const redirectUri = `${origin}/api/auth/instagram/callback`;

  try {
    // 1. Exchange code for short-lived user token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
    );
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(`No access token: ${JSON.stringify(tokenData)}`);

    // 2. Exchange for long-lived token (60 days)
    const longRes = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longRes.json();
    const longToken = longData.access_token || tokenData.access_token;

    let igUserId: string | null = null;
    let igUsername: string | null = null;
    let followers: number | null = null;

    // 3. Get Instagram Business accounts linked to this user
    const igAccountsRes = await fetch(
      `https://graph.facebook.com/v19.0/me/instagram_business_accounts?fields=id,username,followers_count&access_token=${longToken}`
    );
    const igAccountsData = await igAccountsRes.json();

    if (igAccountsData.data?.length > 0) {
      const account = igAccountsData.data[0];
      igUserId = account.id;
      igUsername = account.username || null;
      followers = account.followers_count || null;
    }

    // Fallback: use FB user ID
    if (!igUserId) {
      const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id&access_token=${longToken}`);
      const meData = await meRes.json();
      igUserId = meData.id;
    }

    await prisma.instagramConnection.upsert({
      where: { clientId: parseInt(clientId) },
      create: { clientId: parseInt(clientId), accessToken: longToken, igUserId: igUserId!, igUsername, followers },
      update: { accessToken: longToken, igUserId: igUserId!, igUsername, followers },
    });

    return NextResponse.redirect(`${origin}/?ig_connected=1`);
  } catch (err) {
    console.error("Instagram OAuth error:", err);
    return NextResponse.redirect(`${origin}/?ig_error=server_error`);
  }
}
