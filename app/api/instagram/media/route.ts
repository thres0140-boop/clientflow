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
    (m: any) => m.media_type === "VIDEO" || m.media_type === "REEL" || m.media_product_type === "REELS"
  );

  const reelsWithInsights = await Promise.all(
    reels.map(async (reel: { id: string; [key: string]: unknown }) => {
      const insights: Record<string, number> = {};

      // Helper: extract value from insights response item
      const extractVal = (item: any) =>
        item?.values?.[0]?.value ?? item?.value ?? item?.total_value?.value ?? 0;

      // Fetch reach, saved, shares — no period for newer API versions
      try {
        const baseRes = await fetch(
          `https://graph.instagram.com/v21.0/${reel.id}/insights?metric=reach,saved,shares&access_token=${accessToken}`
        );
        const baseData = await baseRes.json();
        for (const item of baseData.data || []) {
          insights[item.name] = extractVal(item);
        }
      } catch { /* ignore */ }

      // Fetch view count: try plays first (Reels), then video_views (older), then views
      const viewMetrics = ["plays", "video_views", "views"];
      for (const metric of viewMetrics) {
        if (insights.plays != null) break;
        try {
          const r = await fetch(
            `https://graph.instagram.com/v21.0/${reel.id}/insights?metric=${metric}&access_token=${accessToken}`
          );
          const d = await r.json();
          if (!d.error && d.data?.[0]) {
            const val = extractVal(d.data[0]);
            if (val > 0) { insights.plays = val; break; }
          }
        } catch { /* ignore */ }
      }

      return { ...reel, plays: insights.plays, reach: insights.reach, saved: insights.saved, shares: insights.shares };
    })
  );

  return NextResponse.json(reelsWithInsights);
}
