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

  const body: Record<string, unknown> = {
    profileId: PROFILE_ID,
    content,
    platforms: [{ platform: "instagram", accountId: conn.zernioAccountId }],
  };

  if (mediaUrls && mediaUrls.length > 0) {
    body.mediaItems = mediaUrls.map((url: string) => ({ url }));
  }

  if (scheduledFor) {
    body.scheduledFor = scheduledFor; // ISO 8601 string
  }

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
  return NextResponse.json(data, { status: res.ok ? 200 : 400 });
}
