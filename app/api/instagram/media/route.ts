import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const FIELDS = "id,caption,media_type,media_product_type,is_shared_to_feed,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count";

async function enrichReels(reels: any[], accessToken: string) {
  return Promise.all(
    reels.map(async (reel) => {
      const insights: Record<string, number> = {};
      const extractVal = (item: any) =>
        item?.values?.[0]?.value ?? item?.value ?? item?.total_value?.value ?? 0;

      // Fetch metrics in separate calls so one bad metric doesn't kill the rest
      const metricGroups = [
        "reach",
        "saved",
        "shares",
        "reposts",
        "ig_reels_avg_watch_time",
        "ig_reels_video_view_total_time",
        "reels_skip_rate",
        "total_interactions",
      ];
      for (const group of metricGroups) {
        try {
          const r = await fetch(`https://graph.instagram.com/v21.0/${reel.id}/insights?metric=${group}&access_token=${accessToken}`);
          const d = await r.json();
          if (!d.error) for (const item of d.data || []) insights[item.name] = extractVal(item);
        } catch { /* ignore */ }
      }

      for (const metric of ["plays", "video_views", "views"]) {
        if (insights.plays != null) break;
        try {
          const r = await fetch(`https://graph.instagram.com/v21.0/${reel.id}/insights?metric=${metric}&access_token=${accessToken}`);
          const d = await r.json();
          if (!d.error && d.data?.[0]) {
            const val = extractVal(d.data[0]);
            if (val > 0) { insights.plays = val; break; }
          }
        } catch { /* ignore */ }
      }

      return {
        ...reel,
        plays: insights.plays,
        reach: insights.reach,
        saved: insights.saved,
        shares: insights.shares,
        reposts: insights.reposts,
        totalInteractions: insights.total_interactions,
        avgWatchTime: insights.ig_reels_avg_watch_time,
        totalWatchTime: insights.ig_reels_video_view_total_time,
        skipRate: insights.reels_skip_rate,
      };
    })
  );
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  // Optional cursor for pagination — if provided, fetch that page; otherwise start fresh
  const cursor = req.nextUrl.searchParams.get("cursor");

  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { accessToken } = conn;

  // Build the Instagram URL — use cursor if provided, else start from page 1
  const igUrl = cursor
    ? decodeURIComponent(cursor)
    : `https://graph.instagram.com/v21.0/me/media?fields=${FIELDS}&limit=25&access_token=${accessToken}`;

  const mediaRes = await fetch(igUrl);
  const mediaData = await mediaRes.json();
  if (!mediaData.data) return NextResponse.json({ reels: [], nextCursor: null });

  const pageMedia = mediaData.data.filter(
    (m: any) => m.media_type === "VIDEO" || m.media_type === "REEL" || m.media_product_type === "REELS"
  );

  const reels = await enrichReels(pageMedia, accessToken);
  const nextCursor = mediaData.paging?.next ? encodeURIComponent(mediaData.paging.next) : null;

  return NextResponse.json({ reels, nextCursor });
}
