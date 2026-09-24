import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";

// PUT /api/workspaces/[id] → rename / recolor.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const ws = await (prisma as any).workspace.update({
    where: { id: parseInt(id) },
    data: {
      ...(body.name !== undefined ? { name: String(body.name).trim() } : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
      ...(body.order !== undefined ? { order: parseInt(body.order) } : {}),
    },
  });
  return NextResponse.json(ws);
}

// DELETE /api/workspaces/[id] → removes the grouping only. Client.workspaceId is
// `onDelete: SetNull`, so the clients inside SURVIVE and become unassigned (they show in
// every workspace until moved). Never deletes a client. The last workspace can't be removed.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wid = parseInt(id);
  const total = await (prisma as any).workspace.count();
  if (total <= 1) return NextResponse.json({ error: "You need at least one workspace." }, { status: 400 });
  const unassigned = await prisma.client.count({ where: { workspaceId: wid } as any });
  await (prisma as any).workspace.delete({ where: { id: wid } });
  return NextResponse.json({ ok: true, unassigned });
}
