import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchTikTokProfileAndVideos, handleFromInput } from "@/lib/scrapeTikTok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FRESH_MS = 12 * 60 * 60 * 1000; // serve cache without re-scraping if younger than this

// GET /api/tiktok/profile?clientId=&handle=&force=1
// Own-profile analytics. Reads the cached scrape by default (0 API calls); only hits the scraper
// when there's no cache, the cache is stale, or force=1 (the Refresh button). Mirrors how the
// Instagram competitor side serves stored data and re-scrapes on demand.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const force = req.nextUrl.searchParams.get("force") === "1";
  let handle = req.nextUrl.searchParams.get("handle") || "";

  const client = clientId
    ? await (prisma as any).client.findUnique({ where: { id: parseInt(clientId) }, select: { tiktokHandle: true, tiktokProfileData: true, tiktokProfileAt: true } })
    : null;
  if (!handle) handle = client?.tiktokHandle || "";
  if (!handle) return NextResponse.json({ error: "no_handle", profile: null, videos: [] });

  // Serve cache unless forced or stale.
  const cachedAt = client?.tiktokProfileAt ? new Date(client.tiktokProfileAt).getTime() : 0;
  const fresh = cachedAt && Date.now() - cachedAt < FRESH_MS;
  if (!force && client?.tiktokProfileData && fresh) {
    try {
      const cached = JSON.parse(client.tiktokProfileData);
      return NextResponse.json({ ...cached, cachedAt, fromCache: true });
    } catch {/* fall through to scrape */}
  }

  try {
    const { profile, videos } = await fetchTikTokProfileAndVideos(handle, 2);
    if (!profile && videos.length === 0) {
      // scrape failed — if we have any cache, serve it rather than showing an error
      if (client?.tiktokProfileData) {
        try { return NextResponse.json({ ...JSON.parse(client.tiktokProfileData), cachedAt, fromCache: true, stale: true }); } catch {/* ignore */}
      }
      return NextResponse.json({ error: "not_found", profile: null, videos: [] }, { status: 200 });
    }
    const payload = { profile, videos };
    if (clientId) {
      await (prisma as any).client.update({
        where: { id: parseInt(clientId) },
        data: { tiktokProfileData: JSON.stringify(payload), tiktokProfileAt: new Date() },
      }).catch(() => {});
    }
    return NextResponse.json({ ...payload, cachedAt: Date.now(), fromCache: false });
  } catch (e) {
    if (client?.tiktokProfileData) {
      try { return NextResponse.json({ ...JSON.parse(client.tiktokProfileData), cachedAt, fromCache: true, stale: true }); } catch {/* ignore */}
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "scrape_failed", profile: null, videos: [] }, { status: 200 });
  }
}

// PUT /api/tiktok/profile { clientId, handle } — save the client's own TikTok handle (and clear the
// stale cache so the next load scrapes the new account).
export async function PUT(req: NextRequest) {
  const { clientId, handle } = await req.json();
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  await (prisma as any).client.update({
    where: { id: parseInt(String(clientId)) },
    data: { tiktokHandle: handleFromInput(handle || "") || null, tiktokProfileData: null, tiktokProfileAt: null },
  });
  return NextResponse.json({ ok: true });
}
