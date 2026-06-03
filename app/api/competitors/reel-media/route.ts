import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { freshReelMediaUrl } from "@/lib/scrapeCompetitors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/competitors/reel-media?id=<CompetitorReel id>
// Returns a FRESH (non-expired) Instagram CDN video URL for the reel, which the
// browser then plays directly. Nothing downloaded/stored on our side.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const reel = await (prisma as any).competitorReel.findUnique({
    where: { id: parseInt(id) },
    include: { competitor: { select: { handle: true } } },
  });
  if (!reel) return NextResponse.json({ error: "not found" }, { status: 404 });

  const handle = reel.competitor?.handle;
  const fresh = handle ? await freshReelMediaUrl(handle, reel.shortcode) : null;
  if (fresh) {
    (prisma as any).competitorReel.update({ where: { id: reel.id }, data: { mediaUrl: fresh } }).catch(() => {});
  }
  return NextResponse.json({ url: fresh || null, permalink: reel.permalink || null });
}
