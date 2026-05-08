import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const draftId = parseInt(req.nextUrl.searchParams.get("draftId") ?? "");
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
