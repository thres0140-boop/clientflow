import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const where = clientId ? { clientId: parseInt(clientId) } : { clientId: null };
  const stages = await prisma.workflowStage.findMany({
    where,
    orderBy: { order: "asc" },
    include: { assignedTo: true },
  });
  return NextResponse.json(stages);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const clientId = body.clientId ? parseInt(body.clientId) : null;
  const max = await prisma.workflowStage.findFirst({
    where: { clientId },
    orderBy: { order: "desc" },
  });
  const stage = await prisma.workflowStage.create({
    data: {
      clientId,
      name: body.name,
      order: max ? max.order + 1 : 1,
      color: body.color || "#6366f1",
      assignedToId: body.assignedToId ? parseInt(body.assignedToId) : null,
    },
    include: { assignedTo: true },
  });
  return NextResponse.json(stage, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const updates = body.stages as { id: number; order: number; name: string; color: string; assignedToId?: number | null }[];
  await Promise.all(
    updates.map((s) =>
      prisma.workflowStage.update({
        where: { id: s.id },
        data: { order: s.order, name: s.name, color: s.color, assignedToId: s.assignedToId ?? null },
      })
    )
  );
  const clientId = body.clientId ? parseInt(body.clientId) : null;
  const where = body.clientId !== undefined ? { clientId } : { clientId: null };
  const stages = await prisma.workflowStage.findMany({
    where,
    orderBy: { order: "asc" },
    include: { assignedTo: true },
  });
  return NextResponse.json(stages);
}
