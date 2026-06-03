import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { promoteProvenExamples } from "@/lib/conceptExamples";

const IG_BASE = "https://graph.instagram.com/v21.0";

// Vercel Cron — runs every hour.
// For each client with a Meta accessToken:
//   1. Fetch recent Instagram media and link VIDEO/REELS to ContentPieces by timestamp proximity
//   2. Fetch insights for all ContentPieces that have igMediaId set
//   3. Upsert AnalyticsEntry rows with views/likes/shares (never overwrites DM/booking data)
export async function GET(req: NextRequest) {
  const connections = await prisma.instagramConnection.findMany({
    where: { accessToken: { not: "" } },
  });

  let totalLinked = 0;
  let totalSynced = 0;

  for (const conn of connections) {
    try {
      const result = await syncClient(conn.clientId, conn.accessToken);
      totalLinked += result.linked;
      totalSynced += result.synced;
    } catch (e) {
      console.error(`[sync-analytics] client ${conn.clientId} error:`, e);
    }
  }

  // Promote accepted drafts whose posted reel beat the creator's median views.
  let promoted = 0;
  try { promoted = (await promoteProvenExamples()).promoted; } catch (e) { console.error("[promote] error", e); }

  console.log(`[sync-analytics] done — ${totalLinked} media linked, ${totalSynced} synced, ${promoted} examples promoted`);
  return NextResponse.json({ ok: true, totalLinked, totalSynced, promoted });
}

async function syncClient(clientId: number, accessToken: string) {
  let linked = 0;
  let synced = 0;

  // ─── Step A: fetch recent Instagram media ───────────────────────────────
  let mediaItems: any[] = [];
  try {
    const mediaUrl = new URL(`${IG_BASE}/me/media`);
    mediaUrl.searchParams.set("fields", "id,media_type,media_product_type,permalink,timestamp,like_count,comments_count");
    mediaUrl.searchParams.set("access_token", accessToken);
    mediaUrl.searchParams.set("limit", "50");

    const mediaRes = await fetch(mediaUrl.toString());
    if (!mediaRes.ok) {
      const errText = await mediaRes.text();
      console.error(`[sync-analytics] client ${clientId} media fetch failed: ${mediaRes.status} ${errText}`);
      return { linked, synced };
    }
    const mediaData = await mediaRes.json();
    if (mediaData.error) {
      console.error(`[sync-analytics] client ${clientId} media API error:`, mediaData.error);
      return { linked, synced };
    }
    mediaItems = mediaData.data ?? [];
  } catch (e) {
    console.error(`[sync-analytics] client ${clientId} media fetch threw:`, e);
    return { linked, synced };
  }

  // ─── Step B: link media to ContentPieces by timestamp (±3 hours) ────────
  // Instagram Graph API: media_type is "VIDEO" for both regular videos and Reels.
  // media_product_type === "REELS" distinguishes Reels from regular videos.
  // We accept both here since we want to link any video content.
  const videoItems = mediaItems.filter(
    (m: any) => m.media_type === "VIDEO" || m.media_product_type === "REELS"
  );

  // ─── Persist each reel's public permalink onto its day's AnalyticsEntry ──
  // So the Analytics "Link" column is reliable even when the live (heavy) reel
  // fetch fails. Newest-first → first reel per date wins; never overwrite a
  // manually-entered link.
  const seenDates = new Set<string>();
  for (const media of videoItems) {
    if (!media.permalink || !media.timestamp) continue;
    const date = new Date(media.timestamp).toISOString().slice(0, 10);
    if (seenDates.has(date)) continue;
    seenDates.add(date);
    try {
      const existing = await prisma.analyticsEntry.findUnique({ where: { clientId_date: { clientId, date } } });
      if (!existing) {
        await prisma.analyticsEntry.create({ data: { clientId, date, videoLink: media.permalink } as any });
      } else if (!(existing as any).videoLink) {
        await prisma.analyticsEntry.update({ where: { clientId_date: { clientId, date } }, data: { videoLink: media.permalink } as any });
      }
    } catch { /* ignore */ }
  }

  for (const media of videoItems) {
    const mediaTs = new Date(media.timestamp).getTime();
    const THREE_HOURS = 3 * 60 * 60 * 1000;

    // Find a ContentPiece with matching timestamp and no igMediaId yet
    const candidates = await (prisma as any).contentPiece.findMany({
      where: {
        clientId,
        igMediaId: null,
        scheduledDate: { not: null },
      },
    });

    for (const piece of candidates) {
      if (!piece.scheduledDate) continue;
      const pieceTs = new Date(piece.scheduledDate).getTime();
      if (Math.abs(pieceTs - mediaTs) <= THREE_HOURS) {
        await (prisma as any).contentPiece.update({
          where: { id: piece.id },
          data: { igMediaId: media.id, status: "posted" },
        });
        linked++;
        break; // one media → one piece
      }
    }
  }

  // ─── Step C: fetch insights for all ContentPieces with igMediaId ─────────
  const linkedPieces = await (prisma as any).contentPiece.findMany({
    where: {
      clientId,
      igMediaId: { not: null },
      scheduledDate: { not: null },
    },
  });

  for (const piece of linkedPieces) {
    try {
      const insightUrl = new URL(`${IG_BASE}/${piece.igMediaId}/insights`);
      insightUrl.searchParams.set(
        "metric",
        "impressions,reach,likes,comments,shares,saved,plays"
      );
      insightUrl.searchParams.set("access_token", accessToken);

      const insightRes = await fetch(insightUrl.toString());
      if (!insightRes.ok) {
        console.warn(
          `[sync-analytics] client ${clientId} piece ${piece.id} insights fetch failed: ${insightRes.status}`
        );
        continue;
      }
      const insightData = await insightRes.json();
      if (insightData.error) {
        console.warn(
          `[sync-analytics] client ${clientId} piece ${piece.id} insights API error:`,
          insightData.error
        );
        continue;
      }

      const metricsArr: any[] = insightData.data ?? [];
      const metricMap: Record<string, number> = {};
      for (const m of metricsArr) {
        metricMap[m.name] = m.values?.[0]?.value ?? m.value ?? 0;
      }

      // plays = view count for Reels; fall back to impressions
      const views = metricMap["plays"] ?? metricMap["impressions"] ?? 0;
      const likes = metricMap["likes"] ?? 0;
      const shares = metricMap["shares"] ?? 0;

      // Only update if we got real data
      if (views === 0 && likes === 0 && shares === 0) continue;

      const date = piece.scheduledDate.slice(0, 10); // YYYY-MM-DD

      // ─── Step D: upsert AnalyticsEntry ──────────────────────────────────
      // Only set views/likes/shares — never overwrite DM/booking fields
      const updateData: Record<string, number> = {};
      if (views > 0) updateData.views = views;
      if (likes > 0) updateData.likes = likes;
      if (shares > 0) updateData.shares = shares;

      await prisma.analyticsEntry.upsert({
        where: { clientId_date: { clientId, date } },
        create: {
          clientId,
          date,
          conceptId: piece.conceptId ?? null,
          views,
          likes,
          shares,
        },
        update: updateData,
      });

      synced++;
    } catch (e) {
      console.error(
        `[sync-analytics] client ${clientId} piece ${piece.id} insights error:`,
        e
      );
    }
  }

  return { linked, synced };
}
