import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DEFAULT_STAGES = [
  { name: "Record",   color: "#3b82f6", order: 1 },
  { name: "Edit",     color: "#f97316", order: 2 },
  { name: "Check",    color: "#eab308", order: 3 },
  { name: "Schedule", color: "#22c55e", order: 4 },
];

export async function POST(req: NextRequest) {
  const { clientId } = await req.json();
  const cid = parseInt(clientId);

  const existing = await prisma.workflowStage.findMany({ where: { clientId: cid }, orderBy: { order: "asc" } });
  const existingNames = existing.map((s) => s.name.toLowerCase());

  const missing = DEFAULT_STAGES.filter((d) => !existingNames.includes(d.name.toLowerCase()));

  if (missing.length > 0) {
    await prisma.workflowStage.createMany({
      data: missing.map((d) => ({ clientId: cid, ...d })),
    });
  }

  const stages = await prisma.workflowStage.findMany({
    where: { clientId: cid },
    orderBy: { order: "asc" },
    include: { assignedTo: true, assignedCreator: true },
  });

  return NextResponse.json(stages);
}
