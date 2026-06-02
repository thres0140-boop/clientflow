import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bumpAnalytics } from "@/lib/analyticsBump";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;
const PROFILE_ID  = process.env.ZERNIO_PROFILE_ID!;

// GET /api/zernio/conversations?clientId=X
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const cid = parseInt(clientId);

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: cid },
  });

  if (!conn?.zernioAccountId) {
    return NextResponse.json({ error: "no_zernio_account" }, { status: 200 });
  }

  const profileId = (conn as any).zernioProfileId || PROFILE_ID;

  const url = new URL(`${ZERNIO_BASE}/inbox/conversations`);
  url.searchParams.set("profileId", profileId);
  url.searchParams.set("accountId", conn.zernioAccountId);
  url.searchParams.set("platform", "instagram");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${ZERNIO_KEY}`,
      Accept: "application/json",
    },
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("[zernio/conversations] Zernio error", res.status, JSON.stringify(data), "profileId=", profileId, "accountId=", conn.zernioAccountId);
    return NextResponse.json(
      { error: data?.message ?? data?.error ?? "Failed to fetch conversations", zernioStatus: res.status, raw: data },
      { status: res.status === 429 ? 429 : 400 },
    );
  }

  // ── Auto-sync leads ──────────────────────────────────────────────────────
  // For every conversation, if the participant isn't already in the pipeline,
  // create them as a "messaged" lead. This handles incoming DMs automatically.
  const conversations: any[] = data.data ?? data.conversations ?? [];
  if (conversations.length > 0) {
    // Run in background — don't block the response
    syncLeadsInBackground(cid, conversations).catch((e) =>
      console.error("[zernio/conversations] lead sync error:", e)
    );
  }

  return NextResponse.json(data);
}

async function syncLeadsInBackground(clientId: number, conversations: any[]) {
  // Fetch all existing leads for this client once
  const existing = await prisma.dmLead.findMany({
    where: { clientId },
    select: { handle: true },
  });
  const existingHandles = new Set(existing.map((l) => l.handle?.toLowerCase()).filter(Boolean));

  const today = new Date().toISOString().slice(0, 10);

  for (const conv of conversations) {
    const name   = conv.participantName ?? conv.name ?? "Instagram User";
    const handle = conv.participantUsername ?? conv.handle ?? null;

    // Skip if already tracked (by handle, or if no handle available skip to avoid duplicates)
    if (!handle) continue;
    if (existingHandles.has(handle.toLowerCase())) continue;

    await prisma.dmLead.create({
      data: { clientId, name, handle, status: "messaged", date: today },
    });
    await bumpAnalytics(clientId, "messagesSent", today);

    // Add to set so we don't double-create within this batch
    existingHandles.add(handle.toLowerCase());
  }
}
