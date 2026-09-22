import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";

// POST /api/zernio/tiktok-link  { clientId, zernioAccountId, username?, zernioProfileId? }
// Links a Zernio TikTok account to a client (for organic analytics). Mirrors /api/zernio/link
// but stores the TikTok account on the Client row rather than the InstagramConnection.
export async function POST(req: NextRequest) {
  const { clientId, zernioAccountId, username, zernioProfileId } = await req.json();
  if (!clientId || !zernioAccountId) {
    return NextResponse.json({ error: "clientId and zernioAccountId required" }, { status: 400 });
  }
  const cid = parseInt(clientId);
  await (prisma as any).client.update({
    where: { id: cid },
    data: {
      tiktokZernioAccountId: zernioAccountId,
      tiktokZernioUsername: username ?? undefined,
      tiktokZernioProfileId: zernioProfileId ?? undefined,
      tiktokEnabled: true,
    },
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/zernio/tiktok-link  { clientId } — clears the TikTok Zernio link.
export async function DELETE(req: NextRequest) {
  const { clientId } = await req.json();
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  const cid = parseInt(clientId);
  await (prisma as any).client.update({
    where: { id: cid },
    data: { tiktokZernioAccountId: null, tiktokZernioUsername: null },
  });
  return NextResponse.json({ ok: true });
}
