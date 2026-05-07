import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const stage = await prisma.workflowStage.update({
    where: { id: parseInt(id) },
    data: {
      name: body.name,
      color: body.color || "#6366f1",
      assignedToId: body.assignedToId ? parseInt(body.assignedToId) : null,
    },
    include: { assignedTo: true },
  });
  return NextResponse.json(stage);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.workflowStage.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
