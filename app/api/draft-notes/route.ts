import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const draftId = parseInt(req.nextUrl.searchParams.get("draftId") ?? "");
  if (!draftId) return NextResponse.json([]);
  const notes = await prisma.draftNote.findMany({
    where: { draftId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(notes);
}

export async function POST(req: NextRequest) {
  const { draftId, content, author, imageUrl } = await req.json();
  const note = await prisma.draftNote.create({
    data: { draftId, content: content || "", author, imageUrl: imageUrl || null },
  });
  return NextResponse.json(note, { status: 201 });
}
