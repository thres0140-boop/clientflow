import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  await prisma.instagramConnection.deleteMany({
    where: { clientId: parseInt(clientId) },
  });

  return NextResponse.json({ ok: true });
}
