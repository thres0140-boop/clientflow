import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { freshReelMediaUrl } from "@/lib/scrapeCompetitors";
import { cacheImageToR2, isR2Url } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/competitors/reel-cache?id=<CompetitorReel id>
// Copies the reel's video to permanent R2 storage so board embeds never break when
// Instagram's short-lived signed URL expires. Cache-first: returns the stored R2 copy
// if we already have one. Returns { url }.
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const reel = await (prisma as any).competitorReel.findUnique({
    where: { id: parseInt(id) },
    include: { competitor: { select: { handle: true } } },
  });
  if (!reel) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Already cached → reuse (zero cost).
  if (reel.cachedVideoUrl && isR2Url(reel.cachedVideoUrl)) {
    return NextResponse.json({ url: reel.cachedVideoUrl, cached: true });
  }

  const handle = reel.competitor?.handle;
  const fresh = handle ? await freshReelMediaUrl(handle, reel.shortcode) : null;
  if (!fresh) return NextResponse.json({ url: null, error: "no source" });

  // Download from IG + upload to our bucket (one-time).
  const r2url = await cacheImageToR2(fresh, `comp-videos/${reel.id}.mp4`);
  if (!r2url) {
    // Fall back to the fresh (ephemeral) url so it at least plays right now.
    return NextResponse.json({ url: fresh, cached: false, permanent: false });
  }
  (prisma as any).competitorReel.update({ where: { id: reel.id }, data: { cachedVideoUrl: r2url } }).catch(() => {});
  return NextResponse.json({ url: r2url, cached: false, permanent: true });
}
