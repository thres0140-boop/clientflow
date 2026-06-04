import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.ZERNIO_PROFILE_ID!;

// POST /api/zernio/schedule
// Body: { clientId, content, mediaUrls?, scheduledFor? }
// schedules (or publishes immediately) an Instagram post via Zernio
export async function POST(req: NextRequest) {
  const { clientId, content, mediaUrls, scheduledFor, contentPieceId, trialReel } = await req.json();

  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn?.zernioAccountId) {
    return NextResponse.json({ error: "no_zernio_account" }, { status: 400 });
  }

  const profileId = (conn as any).zernioProfileId || PROFILE_ID;

  // Trial reel: Instagram shows it only to non-followers first, then auto-graduates
  // to followers if it performs well (SS_PERFORMANCE). Applies to video reels.
  const platformSpecificData = trialReel === true
    ? { contentType: "reels", trialParams: { graduationStrategy: "SS_PERFORMANCE" } }
    : undefined;

  const body: Record<string, unknown> = {
    profileId,
    content,
    platforms: [{
      platform: "instagram",
      accountId: conn.zernioAccountId,
      ...(platformSpecificData ? { platformSpecificData } : {}),
    }],
  };

  if (mediaUrls && mediaUrls.length > 0) {
    body.mediaItems = mediaUrls.map((url: string) => ({ url }));
  }

  if (scheduledFor) {
    const scheduledDate = new Date(scheduledFor);
    const isNow = scheduledDate.getTime() - Date.now() < 60_000; // within 1 min = post now
    if (isNow) {
      body.publishNow = true;
    } else {
      // scheduledFor must be in UTC ISO 8601 — Zernio interprets it in the given timezone
      body.scheduledFor = scheduledFor;
      body.timezone     = "Europe/Amsterdam"; // TODO: make per-client if needed
    }
  } else {
    // No time given — publish now
    body.publishNow = true;
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

  // Save zernioPostId — Zernio returns _id (MongoDB style)
  const zernioPostId = data?._id ?? data?.id ?? null;
  if (zernioPostId && contentPieceId) {
    await (prisma as any).contentPiece.update({
      where: { id: parseInt(contentPieceId) },
      data: { zernioPostId: String(zernioPostId) },
    }).catch(() => {/* ignore */});
  }

  return NextResponse.json({ ...data, zernioPostId });
}
