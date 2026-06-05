import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const draftId = parseInt(req.nextUrl.searchParams.get("draftId") ?? "");
  const conceptId = parseInt(req.nextUrl.searchParams.get("conceptId") ?? "");
  // By concept: the creator's edit history for this concept (shown in AI Context).
  if (conceptId) {
    const changes = await (prisma as any).draftChange.findMany({
      where: { draft: { conceptId } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, field: true, before: true, after: true, author: true, createdAt: true },
    });
    return NextResponse.json(changes);
  }
  if (!draftId) return NextResponse.json([]);
  const changes = await prisma.draftChange.findMany({
    where: { draftId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(changes);
}

export async function POST(req: NextRequest) {
  const { draftId, field, before, after, author } = await req.json();
  if (before === after) return NextResponse.json(null);
  const change = await prisma.draftChange.create({ data: { draftId, field, before, after, author } });
  return NextResponse.json(change, { status: 201 });
}
