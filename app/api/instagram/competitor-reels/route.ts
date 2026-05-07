import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const handle = req.nextUrl.searchParams.get("handle");
  if (!clientId || !handle) return NextResponse.json({ error: "clientId and handle required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({ where: { clientId: parseInt(clientId) } });
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { accessToken, igUserId } = conn;

  try {
    const mediaFields = "id,media_type,media_product_type,thumbnail_url,media_url,timestamp,like_count,comments_count,caption";
    const fields = `business_discovery.fields(username,followers_count,media_count,media{${mediaFields}})`;

    // Try with igUserId first, then fall back to "me"
    const urls = [
      `https://graph.instagram.com/v21.0/${igUserId}?fields=${encodeURIComponent(fields)}&username=${encodeURIComponent(handle)}&access_token=${accessToken}`,
      `https://graph.instagram.com/v21.0/me?fields=${encodeURIComponent(fields)}&username=${encodeURIComponent(handle)}&access_token=${accessToken}`,
    ];

    let data: Record<string, unknown> = {};
    for (const url of urls) {
      const res = await fetch(url);
      data = await res.json();
      console.log(`Business Discovery for @${handle}:`, JSON.stringify(data).slice(0, 300));
      if (!data.error) break;
    }

    if (data.error) {
      const err = data.error as { message?: string };
      return NextResponse.json({ error: err.message || String(data.error) }, { status: 400 });
    }

    const bd = data.business_discovery as { username?: string; followers_count?: number; media?: { data: unknown[] } } | undefined;

    if (!bd) {
      return NextResponse.json({ error: "Business Discovery not available — account may not be a Business/Creator account", reels: [] }, { status: 200 });
    }

    const allMedia = bd?.media?.data || [];
    // Return all video types (don't over-filter — Instagram API can return VIDEO or REEL)
    const reels = allMedia.filter(
      (m) => {
        const media = m as { media_type?: string };
        return media.media_type === "VIDEO" || media.media_type === "REEL" || media.media_type === "CAROUSEL_ALBUM";
      }
    );

    return NextResponse.json({
      username: bd?.username || handle,
      followers: bd?.followers_count,
      total: allMedia.length,
      reels,
    });
  } catch (err) {
    console.error("competitor-reels error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
