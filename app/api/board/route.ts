import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ snapshot: "{}" });
  const board = await prisma.board.findUnique({ where: { clientId: parseInt(clientId) } });
  return NextResponse.json({ snapshot: board?.snapshot ?? "{}" });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const clientId = parseInt(body.clientId);
  const board = await prisma.board.upsert({
    where: { clientId },
    update: { snapshot: body.snapshot, updatedAt: new Date() },
    create: { clientId, snapshot: body.snapshot },
  });
  return NextResponse.json(board);
}
