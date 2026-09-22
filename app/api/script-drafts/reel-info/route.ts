import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/script-drafts/reel-info?id=<CompetitorReel id>
// Metadata for a Kanban example's Details sidebar — caption, thumbnail, permalink,
// transcript, and the latest known stats. Mirrors what the Instagram reel detail shows.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const reel = await (prisma as any).competitorReel.findUnique({
    where: { id: parseInt(id) },
    select: {
      id: true, caption: true, thumbnailUrl: true, permalink: true, shortcode: true,
      transcript: true, postedAt: true, format: true,
      competitor: { select: { handle: true } },
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1,
        select: { viewCount: true, likeCount: true, commentCount: true } },
    },
  }).catch(() => null);
  if (!reel) return NextResponse.json({ error: "not found" }, { status: 404 });

  const s = reel.snapshots?.[0] || {};
  return NextResponse.json({
    id: reel.id,
    handle: reel.competitor?.handle || null,
    caption: reel.caption || null,
    thumbnailUrl: reel.thumbnailUrl || null,
    permalink: reel.permalink || (reel.shortcode ? `https://www.instagram.com/reel/${reel.shortcode}/` : null),
    transcript: reel.transcript || null,
    format: reel.format || null,
    postedAt: reel.postedAt || null,
    views: s.viewCount ?? null,
    likes: s.likeCount ?? null,
    comments: s.commentCount ?? null,
  });
}
