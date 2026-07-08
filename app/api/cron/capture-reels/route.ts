import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { captureReel } from "@/lib/reelCapture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Backfill/keep-fresh cron for competitor reels. Each pass grabs a batch of reels that
// aren't fully captured yet (missing the R2 video copy or the transcript) and captures them.
// The vendor endpoint oscillates, so a reel that returns "not found" this pass simply stays
// pending and gets retried next pass — over enough passes every live reel resolves. We cap
// the batch so we stay under the function time limit and don't hammer the scraper quota.
const BATCH = 12;

export async function GET(req: NextRequest) {
  // Allow Vercel Cron (no auth header issue) or manual trigger with the migrate token.
  const token = req.nextUrl.searchParams.get("token");
  const isCron = req.headers.get("user-agent")?.includes("vercel-cron") || req.headers.get("x-vercel-cron");
  if (!isCron && token !== "zernio-migrate-2024") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || String(BATCH)) || BATCH, 40);

  // Not-fully-captured (missing video or transcript) AND not given up on. The second OR is
  // null-safe: `NOT (captureStatus = 'unavailable')` is NULL (falsy) for the null rows that
  // are the whole backlog, so we must explicitly allow null.
  const where = {
    AND: [
      { OR: [{ cachedVideoUrl: null }, { transcript: null }] },
      { OR: [{ captureStatus: null }, { captureStatus: { not: "unavailable" } }] },
    ],
  };
  const pending = await (prisma as any).competitorReel.findMany({
    where,
    orderBy: [{ captureTries: "asc" }, { id: "desc" }],
    take: limit,
    select: { id: true },
  });

  let video = 0, transcript = 0;
  const results: any[] = [];
  for (const r of pending) {
    try {
      const res = await captureReel(r.id);
      if (res.video) video++;
      if (res.transcript) transcript++;
      results.push({ id: r.id, ...res });
    } catch (e) {
      results.push({ id: r.id, error: String(e) });
    }
  }

  const remaining = await (prisma as any).competitorReel.count({ where });

  return NextResponse.json({ processed: pending.length, videosCaptured: video, transcriptsCaptured: transcript, remaining, results });
}
