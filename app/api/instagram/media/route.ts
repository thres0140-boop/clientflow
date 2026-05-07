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
    `https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,media_product_type,thumbnail_url,media_url,timestamp,like_count,comments_count&limit=50&access_token=${accessToken}`
  );
  const mediaData = await mediaRes.json();
  if (!mediaData.data) return NextResponse.json([]);

  // Show all videos/reels
  const reels = mediaData.data.filter(
    (m: { media_type: string }) => m.media_type === "VIDEO" || m.media_type === "REEL"
  );

  const reelsWithInsights = await Promise.all(
    reels.map(async (reel: { id: string; [key: string]: unknown }) => {
      const insights: Record<string, number> = {};

      // Fetch reach, saved, shares (work for all video types)
      try {
        const baseRes = await fetch(
          `https://graph.instagram.com/v21.0/${reel.id}/insights?metric=reach,saved,shares&period=lifetime&access_token=${accessToken}`
        );
        const baseData = await baseRes.json();
        for (const item of baseData.data || []) {
          insights[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
        }
      } catch { /* ignore */ }

      // Fetch views separately — try plays (Reels) then video_views (older videos)
      try {
        const playsRes = await fetch(
          `https://graph.instagram.com/v21.0/${reel.id}/insights?metric=plays&period=lifetime&access_token=${accessToken}`
        );
        const playsData = await playsRes.json();
        if (!playsData.error && playsData.data?.[0]) {
          insights.plays = playsData.data[0].values?.[0]?.value ?? playsData.data[0].value ?? 0;
        } else {
          const viewsRes = await fetch(
            `https://graph.instagram.com/v21.0/${reel.id}/insights?metric=video_views&period=lifetime&access_token=${accessToken}`
          );
          const viewsData = await viewsRes.json();
          if (!viewsData.error && viewsData.data?.[0]) {
            insights.plays = viewsData.data[0].values?.[0]?.value ?? viewsData.data[0].value ?? 0;
          }
        }
      } catch { /* ignore */ }

      return { ...reel, plays: insights.plays, reach: insights.reach, saved: insights.saved, shares: insights.shares };
    })
  );

  return NextResponse.json(reelsWithInsights);
}
