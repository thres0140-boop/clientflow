import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureReelVideo } from "@/lib/reelCapture";
import { cacheImageToR2 } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/board/add-video
// Body: { clientId, reelId?, mediaUrl? }
// Resolves a permanent playable URL and QUEUES it on the client's board. We deliberately do
// NOT construct an Excalidraw element here — building one by hand is fragile and can crash the
// canvas. Instead the board itself materializes queued videos client-side (via Excalidraw's
// own element builder) next time it opens.
export async function POST(req: NextRequest) {
  const { clientId, reelId, mediaUrl, meta } = await req.json();
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  const cid = parseInt(String(clientId));

  let resolved: string | null = null;
  if (reelId) {
    const cap = await ensureReelVideo(Number(reelId)).catch(() => ({ url: null }));
    resolved = cap?.url || null;
  } else if (mediaUrl) {
    try { resolved = await cacheImageToR2(mediaUrl, `board-videos/own-${cid}-${Date.now()}.mp4`); } catch { /* fall through */ }
    if (!resolved) resolved = mediaUrl;
  }
  if (!resolved) {
    return NextResponse.json({ error: "Couldn't load this reel's video (the Instagram link may have expired). Try again." }, { status: 502 });
  }
  // Serve through our proxy — even permanent r2.dev urls are rate-limited on direct hits.
  const playable = resolved.startsWith("/api/") ? resolved : `/api/vid?u=${encodeURIComponent(resolved)}`;

  const board = await (prisma as any).board.findUnique({ where: { clientId: cid } });
  let pending: any[] = [];
  try { pending = board?.pendingVideos ? JSON.parse(board.pendingVideos) : []; } catch { pending = []; }
  if (!Array.isArray(pending)) pending = [];
  const m = meta && typeof meta === "object" ? meta : {};
  pending.push({
    url: playable,
    reelId: m.reelId ?? (reelId ? Number(reelId) : null),
    permalink: m.permalink || null,
    thumbnail: m.thumbnail || null,
    handle: m.handle || null,
    date: m.date || null,
    views: m.views ?? null,
    likes: m.likes ?? null,
    comments: m.comments ?? null,
  });

  await (prisma as any).board.upsert({
    where: { clientId: cid },
    update: { pendingVideos: JSON.stringify(pending) },
    create: { clientId: cid, snapshot: "{}", pendingVideos: JSON.stringify(pending) },
  });

  return NextResponse.json({ ok: true });
}
