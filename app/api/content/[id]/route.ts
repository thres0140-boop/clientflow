import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const piece = await prisma.contentPiece.update({
    where: { id: parseInt(id) },
    data: {
      clientId: body.clientId ? parseInt(body.clientId) : undefined,
      conceptId: body.conceptId ? parseInt(body.conceptId) : null,
      title: body.title,
      script: body.script || null,
      contentType: body.contentType || "video",
      status: body.status || "scripted",
      platform: body.platform || null,
      scheduledDate: body.scheduledDate || null,
      hook: body.hook || null,
      caption: body.caption !== undefined ? (body.caption || null) : undefined,
      notes: body.notes || null,
      currentStageId: body.currentStageId !== undefined
        ? (body.currentStageId ? parseInt(body.currentStageId) : null)
        : undefined,
      rawContentUrl: body.rawContentUrl !== undefined ? (body.rawContentUrl || null) : undefined,
    },
    include: {
      client: { select: { name: true, color: true } },
      concept: { select: { name: true } },
    },
  });
  return NextResponse.json(piece);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.contentPiece.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
