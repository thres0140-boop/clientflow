import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  // Lead creation + funnel detection is handled by syncClientPipeline (page load + cron),
  // which stamps real conversation dates. This endpoint just returns conversations for display.
  return NextResponse.json(data);
}
