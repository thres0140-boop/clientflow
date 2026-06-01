import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.ZERNIO_PROFILE_ID!;

// POST /api/zernio/schedule
// Body: { clientId, content, mediaUrls?, scheduledFor? }
// schedules (or publishes immediately) an Instagram post via Zernio
export async function POST(req: NextRequest) {
  const { clientId, content, mediaUrls, scheduledFor } = await req.json();

  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn?.zernioAccountId) {
    return NextResponse.json({ error: "no_zernio_account" }, { status: 400 });
  }

  const profileId = (conn as any).zernioProfileId || PROFILE_ID;

  const body: Record<string, unknown> = {
    profileId,
    content,
    platforms: [{ platform: "instagram", accountId: conn.zernioAccountId }],
  };

  if (mediaUrls && mediaUrls.length > 0) {
    body.mediaItems = mediaUrls.map((url: string) => ({ url }));
  }

  if (scheduledFor) {
    const scheduledDate = new Date(scheduledFor);
    const isNow = scheduledDate.getTime() - Date.now() < 60_000; // within 1 min = post now
    if (isNow) {
      // Publish immediately
      body.status = "published";
    } else {
      // Schedule for future — try both field names Zernio might use
      body.scheduledAt  = scheduledFor;
      body.publishAt    = scheduledFor;
      body.status       = "scheduled";
    }
  }

  console.log("[zernio/schedule] sending body:", JSON.stringify(body));

  const res = await fetch(`${ZERNIO_BASE}/posts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ZERNIO_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  console.log("[zernio/schedule] response", res.status, JSON.stringify(data));

  if (!res.ok) {
    return NextResponse.json({ error: data?.message ?? data?.error ?? "Failed to post", raw: data }, { status: 400 });
  }

  // Save zernioPostId on the ContentPiece so we can update/delete it later
  const zernioPostId = data?.id ?? data?.postId ?? data?.data?.id ?? null;
  const { contentPieceId } = await req.json().catch(() => ({})) as any;
  if (zernioPostId && contentPieceId) {
    await (prisma as any).contentPiece.update({
      where: { id: parseInt(contentPieceId) },
      data: { zernioPostId: String(zernioPostId) },
    }).catch(() => {/* ignore */});
  }

  return NextResponse.json({ ...data, zernioPostId });
}
