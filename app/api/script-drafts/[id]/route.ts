import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, unknown> = {};

  if (body.status !== undefined) data.status = body.status;
  if (body.stageId !== undefined) data.stageId = body.stageId ? parseInt(body.stageId) : null;
  if (body.resurfaceAt !== undefined) data.resurfaceAt = body.resurfaceAt;
  if (body.isSavedIdea !== undefined) data.isSavedIdea = body.isSavedIdea;
  if (body.hook !== undefined) data.hook = body.hook;
  if (body.script !== undefined) data.script = body.script;
  if (body.caption !== undefined) data.caption = body.caption;
  if (body.title !== undefined) data.title = body.title;

  const draft = await prisma.scriptDraft.update({
    where: { id: parseInt(id) },
    data,
    include: {
      concept: { select: { name: true } },
      client: { select: { name: true, color: true } },
      stage: true,
    },
  });
  return NextResponse.json(draft);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.scriptDraft.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
