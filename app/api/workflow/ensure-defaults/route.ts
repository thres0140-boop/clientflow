import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEFAULT_STAGES = [
  { name: "Record",   color: "#3b82f6", order: 1 },
  { name: "Edit",     color: "#f97316", order: 2 },
  { name: "Check",    color: "#eab308", order: 3 },
  { name: "Schedule", color: "#22c55e", order: 4 },
];

const STANDARD_NAMES = DEFAULT_STAGES.map((d) => d.name.toLowerCase());

export async function POST(req: NextRequest) {
  const { clientId } = await req.json();
  const cid = parseInt(clientId);

  const existing = await prisma.workflowStage.findMany({ where: { clientId: cid } });

  // Delete non-standard stages (move their drafts to unassigned first)
  const nonStandard = existing.filter((s) => !STANDARD_NAMES.includes(s.name.toLowerCase()));
  if (nonStandard.length > 0) {
    const ids = nonStandard.map((s) => s.id);
    await prisma.scriptDraft.updateMany({ where: { stageId: { in: ids } }, data: { stageId: null, status: "pending" } });
    await prisma.workflowStage.deleteMany({ where: { id: { in: ids } } });
  }

  // For each standard stage: update if exists (fixing order/color), or create
  for (const def of DEFAULT_STAGES) {
    const match = existing.find((s) => s.name.toLowerCase() === def.name.toLowerCase());
    if (match) {
      await prisma.workflowStage.update({
        where: { id: match.id },
        data: { order: def.order, color: def.color, name: def.name },
      });
    } else {
      await prisma.workflowStage.create({
        data: { clientId: cid, name: def.name, color: def.color, order: def.order },
      });
    }
  }

  const stages = await prisma.workflowStage.findMany({
    where: { clientId: cid },
    orderBy: { order: "asc" },
    include: { assignedTo: true, assignedCreator: true },
  });

  return NextResponse.json(stages);
}
