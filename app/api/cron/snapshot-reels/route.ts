import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { enrichReels } from "@/app/api/instagram/media/route";

export const runtime = "nodejs";
export const maxDuration = 300;

const FIELDS = "id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp,like_count,comments_count";

// GET /api/cron/snapshot-reels — nightly per-reel play-count snapshot for every connected
// client. Builds the history that trend lines need (can't be backfilled, so it runs daily).
// One row per reel per day; re-running the same day just updates the row.
export async function GET() {
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  const conns = await prisma.instagramConnection.findMany({ select: { clientId: true, accessToken: true } });
  let clients = 0, snapped = 0;

  for (const conn of conns) {
    if (!conn.accessToken) continue;
    try {
      const url = `https://graph.instagram.com/v21.0/me/media?fields=${FIELDS}&limit=50&access_token=${conn.accessToken}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data?.data) continue;
      const reels = data.data.filter(
        (m: any) => m.media_type === "VIDEO" || m.media_type === "REEL" || m.media_product_type === "REELS"
      );
      const enriched = await enrichReels(reels, conn.accessToken);
      for (const r of enriched) {
        await (prisma as any).reelSnapshot.upsert({
          where: { clientId_reelId_takenAt: { clientId: conn.clientId, reelId: String(r.id), takenAt: today } },
          create: {
            clientId: conn.clientId, reelId: String(r.id), takenAt: today,
            plays: Math.round(r.plays || 0), likes: Math.round(r.like_count || 0), comments: Math.round(r.comments_count || 0),
          },
          update: {
            plays: Math.round(r.plays || 0), likes: Math.round(r.like_count || 0), comments: Math.round(r.comments_count || 0),
          },
        });
        snapped++;
      }
      clients++;
    } catch (e) {
      console.error(`[cron/snapshot-reels] client ${conn.clientId} error:`, e);
    }
  }

  return NextResponse.json({ ok: true, clients, snapped, date: today });
}
