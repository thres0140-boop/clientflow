import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scrapeCompetitor } from "@/lib/scrapeCompetitors";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

// GET /api/competitors/reels?clientId=  → read-only, instant. Computes latest
// stats per reel + a "delta" over the last ~3 days (exploded detection) from snapshots.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ reels: [] });

  const competitors = await prisma.competitor.findMany({ where: { clientId: parseInt(clientId) } });
  if (!competitors.length) return NextResponse.json({ reels: [], competitors: 0 });

  const reels = await (prisma as any).competitorReel.findMany({
    where: { competitorId: { in: competitors.map((c) => c.id) } },
    include: { snapshots: { orderBy: { capturedAt: "asc" } }, competitor: { select: { handle: true } } },
    orderBy: { postedAt: "desc" },
  });

  const threeDaysAgo = Date.now() - 3 * 86400000;

  // Median views PER competitor — the baseline to spot outliers against that account's norm.
  const viewsByComp: Record<number, number[]> = {};
  for (const r of reels) {
    const v = (r.snapshots?.[r.snapshots.length - 1]?.viewCount) ?? 0;
    if (v > 0) (viewsByComp[r.competitorId] ||= []).push(v);
  }
  const medianByComp: Record<number, number> = {};
  for (const k of Object.keys(viewsByComp)) {
    const arr = viewsByComp[+k].sort((a, b) => a - b);
    medianByComp[+k] = arr.length ? arr[Math.floor(arr.length / 2)] : 0;
  }

  const shaped = reels.map((r: any) => {
    const snaps = r.snapshots as any[];
    const latest = snaps[snaps.length - 1] || {};
    // baseline = the most recent snapshot from BEFORE the 3-day window (else the first one)
    const before = [...snaps].reverse().find((s) => new Date(s.capturedAt).getTime() < threeDaysAgo) || snaps[0] || {};
    const viewsNow = latest.viewCount ?? 0;
    const viewsThen = before.viewCount ?? viewsNow;
    const delta = viewsNow - viewsThen;
    const growthPct = viewsThen > 0 ? (delta / viewsThen) * 100 : null;
    // "exploded" = meaningful absolute jump AND strong relative growth in the window
    const exploded = delta >= 5000 && (growthPct === null || growthPct >= 50) && snaps.length >= 2;
    // "outlier" = did far more than this account's median (their break-out hit)
    const median = medianByComp[r.competitorId] || 0;
    const outlierX = median > 0 && viewsNow > 0 ? viewsNow / median : null;
    const isOutlier = outlierX != null && outlierX >= 2 && viewsNow >= 5000;
    return {
      id: String(r.id),
      handle: r.competitor?.handle,
      caption: r.caption || "",
      thumbnail_url: r.thumbnailUrl || undefined,
      media_url: r.mediaUrl || undefined,
      permalink: r.permalink || undefined,
      timestamp: (r.postedAt || r.firstSeenAt || new Date()).toISOString?.() ?? new Date().toISOString(),
      like_count: latest.likeCount ?? 0,
      comments_count: latest.commentCount ?? 0,
      plays: viewsNow || undefined,
      // extra fields for the UI
      viewDelta3d: delta,
      growthPct3d: growthPct,
      exploded,
      outlierX,
      isOutlier,
      format: r.format || null,
      snapshotCount: snaps.length,
    };
  });

  const lastScraped = competitors
    .map((c) => (c as any).lastScrapedAt ? new Date((c as any).lastScrapedAt).getTime() : 0)
    .reduce((a, b) => Math.max(a, b), 0);
  const errors = competitors.filter((c) => (c as any).lastScrapeError).map((c) => ({ handle: c.handle, error: (c as any).lastScrapeError }));

  return NextResponse.json({ reels: shaped, competitors: competitors.length, lastScraped: lastScraped || null, errors });
}

// POST /api/competitors/reels?clientId=  → manual "Refresh now" with a cooldown.
export async function POST(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const COOLDOWN_HOURS = 6;
  const cutoff = Date.now() - COOLDOWN_HOURS * 3600_000;
  const competitors = await prisma.competitor.findMany({ where: { clientId: parseInt(clientId) } });
  if (!competitors.length) return NextResponse.json({ error: "No competitors added yet." }, { status: 400 });

  const toScrape = competitors.filter((c) => {
    const last = (c as any).lastScrapedAt ? new Date((c as any).lastScrapedAt).getTime() : 0;
    return !last || last <= cutoff;
  });

  let reels = 0;
  for (const c of toScrape) {
    const r = await scrapeCompetitor(c.id);
    reels += r.reels;
    await new Promise((res) => setTimeout(res, 300));
  }

  return NextResponse.json({
    ok: true,
    scraped: toScrape.length,
    skipped: competitors.length - toScrape.length,
    reels,
    cooldownHours: COOLDOWN_HOURS,
  });
}
