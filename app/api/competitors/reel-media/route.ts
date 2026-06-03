import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { freshReelMediaUrl } from "@/lib/scrapeCompetitors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/competitors/reel-media?id=<CompetitorReel id>[&refresh=1]
// Returns a playable Instagram CDN video URL for the reel. Cache-first: if we
// already have a URL fetched within the last hour we return it (0 API requests).
// Otherwise — or with ?refresh=1 (the client's retry when a cached URL turns
// out dead) — we fetch a fresh one and store it.
const CACHE_MS = 60 * 60_000; // 1 hour

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const reel = await (prisma as any).competitorReel.findUnique({
    where: { id: parseInt(id) },
    include: { competitor: { select: { handle: true } } },
  });
  if (!reel) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Cache hit: stored URL that's recent enough → no scraping cost.
  const ageMs = reel.mediaUrlAt ? Date.now() - new Date(reel.mediaUrlAt).getTime() : Infinity;
  if (!force && reel.mediaUrl && ageMs < CACHE_MS) {
    return NextResponse.json({ url: reel.mediaUrl, permalink: reel.permalink || null, cached: true });
  }

  const handle = reel.competitor?.handle;
  const fresh = handle ? await freshReelMediaUrl(handle, reel.shortcode) : null;
  if (fresh) {
    (prisma as any).competitorReel.update({ where: { id: reel.id }, data: { mediaUrl: fresh, mediaUrlAt: new Date() } }).catch(() => {});
  }
  // Fall back to whatever we had stored if a fresh fetch failed (e.g. quota).
  return NextResponse.json({ url: fresh || reel.mediaUrl || null, permalink: reel.permalink || null, cached: false });
}
