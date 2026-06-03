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

  // Download the full video once (a browser-like UA avoids CDN blocks), then serve it —
  // honouring Range requests so the player can seek/scrub.
  const upstream = await fetch(fresh, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" },
  });
  if (!upstream.ok) {
    return NextResponse.json({ error: "upstream_failed", permalink: reel.permalink }, { status: 502 });
  }
  const buf = new Uint8Array(await upstream.arrayBuffer());
  const total = buf.length;
  const ctype = upstream.headers.get("content-type") || "video/mp4";

  const range = req.headers.get("range");
  const m = range ? /bytes=(\d+)-(\d*)/.exec(range) : null;
  if (m) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : total - 1;
    const chunk = buf.subarray(start, end + 1);
    return new Response(chunk, {
      status: 206,
      headers: {
        "content-type": ctype,
        "content-range": `bytes ${start}-${end}/${total}`,
        "accept-ranges": "bytes",
        "content-length": String(chunk.length),
        "cache-control": "private, max-age=3600",
      },
    });
  }
  return new Response(buf, {
    status: 200,
    headers: {
      "content-type": ctype,
      "content-length": String(total),
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
    },
  });
}
