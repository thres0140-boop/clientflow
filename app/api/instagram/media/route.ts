import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { accessToken, igUserId } = conn;

  const mediaRes = await fetch(
    `https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,thumbnail_url,media_url,timestamp,like_count,comments_count&limit=50&access_token=${accessToken}`
  );
  const mediaData = await mediaRes.json();
  console.log("Media API response:", JSON.stringify(mediaData).slice(0, 500));
  if (!mediaData.data) return NextResponse.json([]);

  // In the new Instagram API, reels are returned as VIDEO type
  const reels = mediaData.data.filter(
    (m: { media_type: string }) => m.media_type === "VIDEO" || m.media_type === "REEL"
  );

  const reelsWithInsights = await Promise.all(
    reels.map(async (reel: { id: string; [key: string]: unknown }) => {
      try {
        const insightRes = await fetch(
          `https://graph.instagram.com/v21.0/${reel.id}/insights?metric=plays,reach,saved,shares&access_token=${accessToken}`
        );
        const insightData = await insightRes.json();
        const insights: Record<string, number> = {};
        for (const item of insightData.data || []) {
          insights[item.name] = item.values?.[0]?.value ?? 0;
        }
        return { ...reel, plays: insights.plays, reach: insights.reach, saved: insights.saved, shares: insights.shares };
      } catch {
        return reel;
      }
    })
  );

  return NextResponse.json(reelsWithInsights);
}
