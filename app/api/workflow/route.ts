import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const include = { assignedTo: true, assignedCreator: true };

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const where = clientId ? { clientId: parseInt(clientId) } : { clientId: null };
  const stages = await prisma.workflowStage.findMany({ where, orderBy: { order: "asc" }, include });
  return NextResponse.json(stages);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const clientId = body.clientId ? parseInt(body.clientId) : null;
  const max = await prisma.workflowStage.findFirst({ where: { clientId }, orderBy: { order: "desc" } });
  const stage = await prisma.workflowStage.create({
    data: {
      clientId,
      name: body.name,
      order: max ? max.order + 1 : 1,
      color: body.color || "#6366f1",
      assignedToId: body.assignedToId ? parseInt(body.assignedToId) : null,
      assignedCreatorId: body.assignedCreatorId ? parseInt(body.assignedCreatorId) : null,
      assignedToOwner: body.assignedToOwner ?? false,
    },
    include,
  });
  return NextResponse.json(stage, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const updates = body.stages as {
    id: number; order: number; name: string; color: string;
    assignedToId?: number | null; assignedCreatorId?: number | null; assignedToOwner?: boolean; assignedToClient?: boolean; assignees?: string;
  }[];
  await Promise.all(
    updates.map((s) =>
      prisma.workflowStage.update({
        where: { id: s.id },
        data: {
          order: s.order, name: s.name, color: s.color,
          assignedToId: s.assignedToId ?? null,
          assignedCreatorId: s.assignedCreatorId ?? null,
          assignedToOwner: s.assignedToOwner ?? false,
          assignedToClient: s.assignedToClient ?? false,
          assignees: s.assignees ?? "[]",
        },
      })
    )
  );
  const clientId = body.clientId ? parseInt(body.clientId) : null;
  const where = body.clientId !== undefined ? { clientId } : { clientId: null };
  const stages = await prisma.workflowStage.findMany({ where, orderBy: { order: "asc" }, include });
  return NextResponse.json(stages);
}
