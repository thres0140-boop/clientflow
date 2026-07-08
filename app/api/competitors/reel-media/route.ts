import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { freshReelMediaUrl } from "@/lib/scrapeCompetitors";
import { ensureReelVideo } from "@/lib/reelCapture";
import { isR2Url } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const reelId = parseInt(id);
  const reel = await (prisma as any).competitorReel.findUnique({
    where: { id: reelId },
    select: { id: true, permalink: true, cachedVideoUrl: true, mediaUrl: true, mediaUrlAt: true },
  });
  if (!reel) return json({ error: "not found" }, { status: 404 });

  // Best case: we already own a permanent R2 copy of the video — serve it. Zero vendor cost,
  // never expires. This is the capture-once path that makes playback reliable.
  if (!force && reel.cachedVideoUrl && isR2Url(reel.cachedVideoUrl)) {
    return json({ url: reel.cachedVideoUrl, permalink: reel.permalink || null, cached: true, permanent: true });
  }

  // Not captured yet: capture it now (downloads the mp4 to R2 + stores it) so this is the
  // last time we ever resolve it live. If the vendor is in a bad window this returns null,
  // and we fall back to a short-lived stored url so it still plays.
  const cap = await ensureReelVideo(reelId).catch(() => ({ url: null, permanent: false }));
  if (cap.url) {
    return json({ url: cap.url, permalink: reel.permalink || null, cached: false, permanent: cap.permanent });
  }
  const ageMs = reel.mediaUrlAt ? Date.now() - new Date(reel.mediaUrlAt).getTime() : Infinity;
  if (reel.mediaUrl && ageMs < CACHE_MS) {
    return json({ url: reel.mediaUrl, permalink: reel.permalink || null, cached: true });
  }
  return json({ url: null, permalink: reel.permalink || null, cached: false });
}
