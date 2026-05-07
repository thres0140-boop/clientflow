import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const where = clientId ? { clientId: parseInt(clientId) } : {};
  const content = await prisma.contentPiece.findMany({
    where,
    include: {
      client: { select: { name: true, color: true } },
      concept: { select: { name: true } },
      stageHistory: {
        include: {
          stage: true,
          completedBy: { select: { name: true, color: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { scheduledDate: "asc" },
  });
  return NextResponse.json(content);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const piece = await prisma.contentPiece.create({
    data: {
      clientId: parseInt(body.clientId),
      conceptId: body.conceptId ? parseInt(body.conceptId) : null,
      title: body.title,
      script: body.script || null,
      contentType: body.contentType || "video",
      status: body.status || "scripted",
      platform: body.platform || null,
      scheduledDate: body.scheduledDate || null,
      hook: body.hook || null,
      caption: body.caption || null,
      notes: body.notes || null,
      currentStageId: body.currentStageId ? parseInt(body.currentStageId) : null,
    },
    include: {
      client: { select: { name: true, color: true } },
      concept: { select: { name: true } },
    },
  });

  // If starting in a stage, create history entry and notify assigned person
  if (body.currentStageId) {
    const stageId = parseInt(body.currentStageId);
    await prisma.stageHistory.create({
      data: { contentId: piece.id, stageId },
    });

    const stage = await prisma.workflowStage.findUnique({
      where: { id: stageId },
      include: { assignedTo: true },
    });

    if (stage?.assignedTo) {
      await prisma.notification.create({
        data: {
          memberId: stage.assignedTo.id,
          contentId: piece.id,
          stageId,
          message: `New content "${piece.title}" is ready for: ${stage.name}`,
        },
      });
    }
  }

  if (body.conceptId) {
    await prisma.concept.update({
      where: { id: parseInt(body.conceptId) },
      data: { timesUsed: { increment: 1 } },
    });
  }

  return NextResponse.json(piece, { status: 201 });
}
