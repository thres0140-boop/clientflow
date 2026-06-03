import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { freshReelMediaUrl } from "@/lib/scrapeCompetitors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/competitors/reel-video?id=<CompetitorReel id>
// Fetches a fresh (non-expired) video URL for the reel and streams it through us
// so it plays in-app (cross-origin + expiry handled). Nothing is stored.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const reel = await (prisma as any).competitorReel.findUnique({
    where: { id: parseInt(id) },
    include: { competitor: { select: { handle: true } } },
  });
  if (!reel) return NextResponse.json({ error: "not found" }, { status: 404 });

  const handle = reel.competitor?.handle;
  if (!handle) return NextResponse.json({ error: "no handle" }, { status: 404 });

  const fresh = await freshReelMediaUrl(handle, reel.shortcode);
  if (!fresh) {
    // Couldn't find a fresh URL (e.g. very old reel) — tell the client to fall back.
    return NextResponse.json({ error: "no_fresh_url", permalink: reel.permalink }, { status: 404 });
  }

  // keep the stored URL fresh-ish for other uses
  (prisma as any).competitorReel.update({ where: { id: reel.id }, data: { mediaUrl: fresh } }).catch(() => {});

  // Proxy with Range support so the player can seek.
  const range = req.headers.get("range");
  const upstream = await fetch(fresh, { headers: range ? { Range: range } : {} });
  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: "upstream_failed", permalink: reel.permalink }, { status: 502 });
  }

  const headers = new Headers();
  const pass = ["content-type", "content-length", "content-range", "accept-ranges"];
  for (const h of pass) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("content-type")) headers.set("content-type", "video/mp4");
  if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");

  return new Response(upstream.body, { status: upstream.status, headers });
}
