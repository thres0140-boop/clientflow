import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/ai/db/prisma";

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

// DELETE /api/workspaces/[id] → only when empty (move its clients out first).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wid = parseInt(id);
  const count = await prisma.client.count({ where: { workspaceId: wid } as any });
  if (count > 0) return NextResponse.json({ error: `Move its ${count} client(s) to another workspace first.` }, { status: 400 });
  const total = await (prisma as any).workspace.count();
  if (total <= 1) return NextResponse.json({ error: "You need at least one workspace." }, { status: 400 });
  await (prisma as any).workspace.delete({ where: { id: wid } });
  return NextResponse.json({ ok: true });
}
