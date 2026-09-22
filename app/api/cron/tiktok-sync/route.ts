import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { syncTikTokCompetitor } from "@/features/tiktok/server/tiktokSync";
import { snapshotOfficial } from "@/features/tiktok/server/tiktokOAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily-ish snapshot cron. Scrapes TikTok competitors that haven't been synced in ~20h, recording a
// fresh CompetitorReelSnapshot per video so we accumulate a day-over-day view history (the basis for
// real "going viral" growth detection). Time-boxed and batched so a big list is covered across a few
// runs rather than one that times out. Runs on the schedule in vercel.json.
export async function GET(req: NextRequest) {
  const started = Date.now();
  const BUDGET_MS = 250_000;         // stay well under maxDuration
  const STALE_MS = 20 * 3600 * 1000; // only touch competitors not synced in the last ~20h
  const BATCH = 80;

  const staleBefore = new Date(Date.now() - STALE_MS);
  const targets = await (prisma as any).competitor.findMany({
    where: { platform: "tiktok", OR: [{ lastScrapedAt: null }, { lastScrapedAt: { lt: staleBefore } }] },
    orderBy: [{ lastScrapedAt: { sort: "asc", nulls: "first" } }],
    take: BATCH,
    select: { id: true, handle: true },
  });

  let done = 0, found = 0, failed = 0;
  let rateLimited = false;
  for (const c of targets) {
    if (Date.now() - started > BUDGET_MS) break;
    try {
      const res = await syncTikTokCompetitor(c.id, c.handle);
      if (res.found) found++;
      done++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "rate_limited") { rateLimited = true; break; } // stop the run; next run resumes
      failed++;
      await (prisma as any).competitor.update({ where: { id: c.id }, data: { lastScrapeError: msg } }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 200)); // gentle pacing
  }

  // Snapshot the official stats of every connected client (cheap: one API call each) → growth charts.
  let snapped = 0;
  const connected = await (prisma as any).client.findMany({ where: { tiktokAccessToken: { not: null } }, select: { id: true } }).catch(() => []);
  for (const c of connected) {
    if (Date.now() - started > BUDGET_MS) break;
    try { if (await snapshotOfficial(c.id)) snapped++; } catch { /* skip */ }
    await new Promise((r) => setTimeout(r, 150));
  }

  return NextResponse.json({ ok: true, considered: targets.length, done, found, failed, rateLimited, snapped, ms: Date.now() - started });
}
