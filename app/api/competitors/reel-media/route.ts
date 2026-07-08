import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { freshReelMediaUrl } from "@/lib/scrapeCompetitors";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Never let the browser/CDN cache a media lookup — a stale {url:null} (from a moment the
// scraper hiccuped) would otherwise keep a reel stuck on the embed fallback forever.
const NOSTORE = { "Cache-Control": "no-store, max-age=0" };
const json = (body: any, init?: { status?: number }) =>
  NextResponse.json(body, { status: init?.status, headers: NOSTORE });

// GET /api/competitors/reel-media?id=<CompetitorReel id>[&refresh=1]
// Returns a playable Instagram CDN video URL for the reel. Cache-first: if we
// already have a URL fetched within the last hour we return it (0 API requests).
// Otherwise — or with ?refresh=1 (the client's retry when a cached URL turns
// out dead) — we fetch a fresh one and store it.
const CACHE_MS = 60 * 60_000; // 1 hour

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const force = req.nextUrl.searchParams.get("refresh") === "1";

  // Candidate-preview path: reels aren't stored in the DB, so resolve live by
  // handle+shortcode (one scrape request, no caching).
  if (!id) {
    const handle = req.nextUrl.searchParams.get("handle") || "";
    const shortcode = req.nextUrl.searchParams.get("shortcode") || "";
    if (!shortcode) return json({ error: "id or shortcode required" }, { status: 400 });
    const url = await freshReelMediaUrl(handle, shortcode).catch(() => null);
    return json({ url: url || null, permalink: `https://instagram.com/reel/${shortcode}`, cached: false });
  }

  const reel = await (prisma as any).competitorReel.findUnique({
    where: { id: parseInt(id) },
    include: { competitor: { select: { handle: true } } },
  });
  if (!reel) return json({ error: "not found" }, { status: 404 });

  // Cache hit: stored URL that's recent enough → no scraping cost.
  const ageMs = reel.mediaUrlAt ? Date.now() - new Date(reel.mediaUrlAt).getTime() : Infinity;
  if (!force && reel.mediaUrl && ageMs < CACHE_MS) {
    return json({ url: reel.mediaUrl, permalink: reel.permalink || null, cached: true });
  }

  const handle = reel.competitor?.handle;
  const fresh = handle ? await freshReelMediaUrl(handle, reel.shortcode) : null;
  if (fresh) {
    (prisma as any).competitorReel.update({ where: { id: reel.id }, data: { mediaUrl: fresh, mediaUrlAt: new Date() } }).catch(() => {});
  }
  // Fall back to whatever we had stored if a fresh fetch failed (e.g. quota).
  return json({ url: fresh || reel.mediaUrl || null, permalink: reel.permalink || null, cached: false });
}
