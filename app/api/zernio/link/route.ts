import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/zernio/link  { clientId, zernioAccountId, igUsername? }
// Links a Zernio social account to a client in our DB.
export async function POST(req: NextRequest) {
  const { clientId, zernioAccountId, igUsername } = await req.json();
  if (!clientId || !zernioAccountId) {
    return NextResponse.json({ error: "clientId and zernioAccountId required" }, { status: 400 });
  }

  const cid = parseInt(clientId);
  await prisma.instagramConnection.upsert({
    where:  { clientId: cid },
    create: { clientId: cid, accessToken: "", igUserId: "", zernioAccountId, igUsername: igUsername ?? null },
    update: { zernioAccountId, ...(igUsername ? { igUsername } : {}) },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/zernio/link  { clientId }
// Clears the Zernio account link for a client.
export async function DELETE(req: NextRequest) {
  const { clientId } = await req.json();
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const cid = parseInt(clientId);
  await prisma.instagramConnection.updateMany({
    where: { clientId: cid },
    data:  { zernioAccountId: null, igUsername: null },
  });

  return NextResponse.json({ ok: true });
}
