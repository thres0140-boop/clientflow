import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY = process.env.ZERNIO_API_KEY!;

// POST /api/zernio/cancel { draftId }
// Cancels a scheduled post on Zernio AND clears the local booking. If we don't have the
// Zernio post id stored (older bookings didn't capture it), we recover it by listing
// Zernio's posts and matching on the finished-video URL (exact, safe) or caption.
export async function POST(req: NextRequest) {
  const { draftId } = await req.json();
  const id = parseInt(String(draftId));
  if (!id) return NextResponse.json({ error: "draftId required" }, { status: 400 });

  const draft = await (prisma as any).scriptDraft.findUnique({ where: { id } });
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });

  let postId: string | null = draft.zernioPostId || null;
  let recovered = false;

  // Recover the post id if missing, by matching the video URL (or caption) on Zernio.
  if (!postId) {
    try {
      const r = await fetch(`${ZERNIO_BASE}/posts`, { headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" } });
      if (r.ok) {
        const j = await r.json();
        const posts: any[] = Array.isArray(j) ? j : (j.posts || j.data || []);
        const vid = (draft.editedVideoUrl || "").trim();
        const cap = (draft.caption || "").trim();
        const match = posts.find((p) => {
          const media: any[] = p.mediaItems || p.media || [];
          if (vid && media.some((m) => (m?.url || "") === vid)) return true;
          if (cap && (p.content || "").trim() === cap) return true;
          return false;
        });
        if (match) { postId = String(match._id ?? match.id); recovered = true; }
      }
    } catch { /* ignore — fall through to local clear */ }
  }

  let zernioDeleted = false;
  if (postId) {
    const del = await fetch(`${ZERNIO_BASE}/posts/${postId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" },
    }).catch(() => null);
    zernioDeleted = !!del && (del.ok || del.status === 404);
  }

  // Clear the local booking regardless (so the calendar stops showing it as auto-posting).
  await (prisma as any).scriptDraft.update({
    where: { id },
    data: { zernioBooked: false, zernioPostId: null },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    zernioDeleted,
    recovered,
    // true when we genuinely could not find/delete it on Zernio — UI should warn.
    needsManual: !postId,
  });
}
