import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Advance content to the next workflow stage, log history, fire notification
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { contentId, stageId, completedById, notes, rawContentUrl } = body;

  // Get all stages ordered
  const allStages = await prisma.workflowStage.findMany({
    orderBy: { order: "asc" },
    include: { assignedTo: true },
  });

  const currentStageIndex = allStages.findIndex((s) => s.id === stageId);
  const nextStage = allStages[currentStageIndex + 1] ?? null;

  // Mark current stage as complete in history
  await prisma.stageHistory.upsert({
    where: {
      // We'll use a unique constraint workaround — find existing or create
      id: (await prisma.stageHistory.findFirst({
        where: { contentId, stageId, completedAt: null },
      }))?.id ?? 0,
    },
    update: {
      completedAt: new Date(),
      completedById: completedById ? parseInt(completedById) : null,
      notes: notes || null,
      rawContentUrl: rawContentUrl || null,
    },
    create: {
      contentId,
      stageId,
      completedAt: new Date(),
      completedById: completedById ? parseInt(completedById) : null,
      notes: notes || null,
      rawContentUrl: rawContentUrl || null,
    },
  });

  // Move content to next stage (or null if done)
  await prisma.contentPiece.update({
    where: { id: contentId },
    data: {
      currentStageId: nextStage?.id ?? null,
      rawContentUrl: rawContentUrl || undefined,
      // Update status if last stage
      status: nextStage ? undefined : "posted",
    },
  });

  // Create history entry for next stage
  if (nextStage) {
    await prisma.stageHistory.create({
      data: { contentId, stageId: nextStage.id },
    });

    // Fire notification to assigned person
    if (nextStage.assignedTo) {
      const content = await prisma.contentPiece.findUnique({
        where: { id: contentId },
        include: { client: { select: { name: true } } },
      });
      await prisma.notification.create({
        data: {
          memberId: nextStage.assignedTo.id,
          contentId,
          stageId: nextStage.id,
          message: `"${content?.title}" is ready for: ${nextStage.name}${content?.client ? ` (${content.client.name})` : ""}`,
        },
      });
    }
  }

  return NextResponse.json({ ok: true, nextStage });
}
