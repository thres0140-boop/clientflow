import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { handleFromInput } from "@/lib/scrapeTikTok";
import { syncTikTokCompetitor } from "@/lib/tiktokSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Shared scrape-one helper (also used by the daily snapshot cron).
const scrapeOne = syncTikTokCompetitor;

// GET /api/tiktok/competitors?clientId= → { competitors, reels }
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ competitors: [], reels: [] });
  const cid = parseInt(clientId);
  const competitors = await (prisma as any).competitor.findMany({ where: { clientId: cid, platform: "tiktok" }, orderBy: { createdAt: "desc" } });
  const reels = await (prisma as any).competitorReel.findMany({
    where: { competitorId: { in: competitors.map((c: any) => c.id) }, platform: "tiktok" }, // eslint-disable-line @typescript-eslint/no-explicit-any
    include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 }, competitor: { select: { handle: true } } },
    orderBy: { postedAt: "desc" },
  });
  const shaped = reels.map((r: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const s = r.snapshots?.[0] || {};
    return {
      id: String(r.id), videoId: r.shortcode, handle: r.competitor?.handle, caption: r.caption || "",
      thumbnail_url: r.thumbnailUrl || undefined, media_url: r.mediaUrl || undefined, permalink: r.permalink || undefined,
      timestamp: (r.postedAt || r.firstSeenAt || new Date()).toISOString?.() ?? new Date().toISOString(),
      plays: s.viewCount ?? undefined, like_count: s.likeCount ?? 0, comments_count: s.commentCount ?? 0,
    };
  });
  return NextResponse.json({ competitors, reels: shaped });
}

// POST /api/tiktok/competitors { clientId, handle } → add + scrape. Or ?refresh=1 → re-scrape all.
export async function POST(req: NextRequest) {
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const body = await req.json().catch(() => ({}));
  const clientId = parseInt(String(body.clientId || req.nextUrl.searchParams.get("clientId") || ""));
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  if (refresh) {
    const comps = await (prisma as any).competitor.findMany({ where: { clientId, platform: "tiktok" }, select: { id: true, handle: true } });
    let total = 0;
    for (const c of comps) { try { total += (await scrapeOne(c.id, c.handle)).reels; } catch { /* skip */ } await new Promise((r) => setTimeout(r, 300)); }
    return NextResponse.json({ ok: true, scraped: comps.length, reels: total });
  }

  // Sync a single competitor: { syncId } — scrape just that one (short request, no timeout risk).
  // The browser drives the whole list one-by-one so it can show per-row progress and never blows
  // the function time limit.
  if (body.syncId) {
    const id = parseInt(String(body.syncId));
    const c = await (prisma as any).competitor.findUnique({ where: { id }, select: { handle: true } });
    if (!c) return NextResponse.json({ ok: false, error: "not_found" }, { status: 200 });
    try {
      const { reels, found } = await scrapeOne(id, c.handle);
      const competitor = await (prisma as any).competitor.findUnique({
        where: { id },
        select: { id: true, handle: true, name: true, bio: true, followerCount: true, followingCount: true, postCount: true, profilePicUrl: true, verified: true, tags: true, lastScrapedAt: true },
      });
      return NextResponse.json({ ok: true, found, reels, competitor });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "scrape_failed";
      await (prisma as any).competitor.update({ where: { id }, data: { lastScrapeError: msg } }).catch(() => {});
      return NextResponse.json({ ok: false, error: msg }, { status: 200 });
    }
  }

  // Bulk import: { handles: [{ handle, tags? }] } — create rows instantly WITHOUT scraping (fast +
  // no API cost). Follower/video stats fill in when the user hits "Sync data". Dedupes existing.
  if (Array.isArray(body.handles)) {
    const existing = new Set(
      (await (prisma as any).competitor.findMany({ where: { clientId, platform: "tiktok" }, select: { handle: true } }))
        .map((c: any) => c.handle.toLowerCase())
    );
    let created = 0, skipped = 0;
    for (const item of body.handles) {
      const raw = typeof item === "string" ? item : item?.handle;
      const handle = handleFromInput(String(raw || ""));
      const tags = typeof item === "object" && item?.tags ? String(item.tags) : null;
      if (!handle || handle.includes(" ") || existing.has(handle.toLowerCase())) { skipped++; continue; }
      existing.add(handle.toLowerCase());
      await (prisma as any).competitor.create({ data: { clientId, platform: "tiktok", handle, name: handle, tags } }).catch(() => { skipped++; });
      created++;
    }
    return NextResponse.json({ ok: true, created, skipped });
  }

  const handle = handleFromInput(String(body.handle || ""));
  if (!handle) return NextResponse.json({ error: "handle required" }, { status: 400 });
  const competitor = await (prisma as any).competitor.create({ data: { clientId, platform: "tiktok", handle } });
  scrapeOne(competitor.id, handle).catch(() => {}); // fire-and-forget; grid fills in shortly
  return NextResponse.json({ ok: true, id: competitor.id });
}

// PUT /api/tiktok/competitors { id, tags } — edit a competitor (currently just tags).
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = parseInt(String(body.id || ""));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const data: any = {};
  if (body.tags !== undefined) data.tags = String(body.tags) || null;
  if (body.name !== undefined) data.name = String(body.name) || null;
  await (prisma as any).competitor.update({ where: { id }, data }).catch(() => {});
  return NextResponse.json({ ok: true });
}

// DELETE /api/tiktok/competitors?id=
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await (prisma as any).competitor.delete({ where: { id: parseInt(id) } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
