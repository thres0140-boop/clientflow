import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST { clientId, unipileAccountId } — links a Unipile account to a client
export async function POST(req: NextRequest) {
  const { clientId, unipileAccountId } = await req.json();

  await prisma.instagramConnection.upsert({
    where: { clientId: parseInt(clientId) },
    create: {
      clientId: parseInt(clientId),
      accessToken: "",
      igUserId: "",
      unipileAccountId,
    },
    update: { unipileAccountId },
  });

  return NextResponse.json({ ok: true });
}
