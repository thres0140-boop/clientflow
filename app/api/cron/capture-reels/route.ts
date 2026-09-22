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
  try {
    // Allow Vercel Cron (no auth header issue) or manual trigger with the migrate token.
    const token = req.nextUrl.searchParams.get("token");
    const isCron = req.headers.get("user-agent")?.includes("vercel-cron") || req.headers.get("x-vercel-cron");
    if (!isCron && token !== "zernio-migrate-2024") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const videoOnly = req.nextUrl.searchParams.get("videoOnly") === "1";
    // Video-only passes skip Whisper, so each reel is ~3x faster → we can do more per window.
    const cap = videoOnly ? 30 : 20;
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || String(videoOnly ? 24 : BATCH)) || BATCH, cap);

    const live = { OR: [{ captureStatus: null }, { captureStatus: { not: "unavailable" } }] };
    // PLAYABILITY FIRST: a reel is only watchable once it has an R2 video copy, and that's the
    // slow part users feel ("Not ready yet"). So we burn down every reel missing its video
    // BEFORE spending any time on transcripts — each video-only reel skips the 90s Whisper call.
    const videoWhere = { AND: [{ cachedVideoUrl: null }, live] };

    let video = 0, transcript = 0, phase = "video";
    const results: any[] = [];

    const videoPending = await (prisma as any).competitorReel.findMany({
      where: videoWhere,
      orderBy: [{ captureTries: "asc" }, { id: "desc" }],
      take: limit,
      select: { id: true },
    });

    if (videoPending.length > 0) {
      // Import lazily so a video-only pass never pulls in the transcription path.
      const { ensureReelVideo } = await import("@/lib/reelCapture");
      for (const r of videoPending) {
        try {
          const v = await ensureReelVideo(r.id);
          if (v.permanent) video++;
          results.push({ id: r.id, video: !!v.permanent });
        } catch (e) { results.push({ id: r.id, error: String(e).slice(0, 200) }); }
      }
    } else if (!videoOnly) {
      // Every reel that CAN have a video now does → fill in transcripts (video already cached).
      phase = "transcript";
      const tWhere = { AND: [{ cachedVideoUrl: { not: null } }, { transcript: null }, live] };
      const tPending = await (prisma as any).competitorReel.findMany({
        where: tWhere, orderBy: [{ captureTries: "asc" }, { id: "desc" }], take: BATCH, select: { id: true },
      });
      for (const r of tPending) {
        try {
          const res = await captureReel(r.id);
          if (res.video) video++;
          if (res.transcript) transcript++;
          results.push({ id: r.id, ...res });
        } catch (e) { results.push({ id: r.id, error: String(e).slice(0, 200) }); }
      }
    }

    const remainingVideo = await (prisma as any).competitorReel.count({ where: videoWhere });
    return NextResponse.json({ phase, processed: results.length, videosCaptured: video, transcriptsCaptured: transcript, remainingVideo, results });
  } catch (e) {
    return NextResponse.json({ error: "handler crashed: " + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
