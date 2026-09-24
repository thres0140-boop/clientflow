import { NextRequest, NextResponse } from "next/server";
import { aiSchemaReady } from "@/ai/db/ready";
import { prisma } from "@/ai/db/prisma";
import { scrapeCompetitor, scrapeCompetitorProfile } from "@/ai/features/instagram/server/scrapeCompetitors";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// GET /api/cron/scrape-competitors
// Daily background scrape: each unique competitor handle scraped once (skip if
// scraped < TTL ago). Sequential + per-handle try/catch so one failure can't
// kill the run. UI never scrapes — it only reads what this writes.
export async function GET(req: NextRequest) {
  if (!(await aiSchemaReady())) return NextResponse.json({ ok: true, skipped: "schema_not_applied" }); // AI DB has no schema yet → no-op
  // Low default so the once-daily morning run always actually scrapes (it only skips a
  // competitor scraped within the last few hours — e.g. a manual "Refresh now" just before).
  const TTL_HOURS = parseInt(req.nextUrl.searchParams.get("ttlHours") || "6");
  const full = req.nextUrl.searchParams.get("full") === "1";
  // Cost control: the scheduled daily run is a LIGHT top-up — 1 page (newest ~12 reels) per
  // competitor, which catches new posts + refreshes stats on the recent/trending reels for ~1
  // API call each. Pass ?pages=5 (or ?full=1) for a deep pull. Profile (followers) only
  // refreshes on a deep pass, since it barely changes and costs an extra call each.
  const pages = full ? undefined : parseInt(req.nextUrl.searchParams.get("pages") || "1") || 1;
  const refreshProfile = full || req.nextUrl.searchParams.get("profile") === "1";
  const cutoff = Date.now() - TTL_HOURS * 3600_000;

  const competitors = await prisma.competitor.findMany({ orderBy: { id: "asc" } });

  // Dedupe by handle — two clients tracking @nike = one scrape (we still snapshot
  // each competitor row so each client's view is populated).
  const results: { id: number; handle: string; ok: boolean; reels: number; error?: string; skipped?: boolean }[] = [];

  for (const c of competitors) {
    const last = (c as any).lastScrapedAt ? new Date((c as any).lastScrapedAt).getTime() : 0;
    if (!full && last && last > cutoff) {
      results.push({ id: c.id, handle: c.handle, ok: true, reels: 0, skipped: true });
      continue;
    }
    try {
      if (refreshProfile) await scrapeCompetitorProfile(c.id).catch(() => {}); // follower/post stats (deep passes only)
      const r = await scrapeCompetitor(c.id, { full, pages });
      results.push({ id: c.id, handle: c.handle, ...r });
    } catch (err) {
      results.push({ id: c.id, handle: c.handle, ok: false, reels: 0, error: String(err).slice(0, 200) });
    }
    // gentle throttle to avoid provider rate limits
    await new Promise((res) => setTimeout(res, 400));
  }

  const scraped = results.filter((r) => !r.skipped).length;
  const reels = results.reduce((s, r) => s + (r.reels || 0), 0);
  return NextResponse.json({ ok: true, competitors: competitors.length, scraped, skipped: competitors.length - scraped, reels, results });
}
