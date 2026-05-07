import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const concept = await prisma.concept.update({
    where: { id: parseInt(id) },
    data: {
      clientId: body.clientId ? parseInt(body.clientId) : null,
      name: body.name,
      hookType: body.hookType || null,
      textHook: body.textHook || null,
      audioHook: body.audioHook || null,
      videoType: body.videoType || null,
      angle: body.angle || null,
      structure: body.structure || null,
      guidelines: body.guidelines || null,
      exampleUrl: body.exampleUrl || null,
      scriptExamples: body.scriptExamples || null,
      notes: body.notes || null,
      ...(body.isIdea !== undefined ? { isIdea: body.isIdea } : {}),
    },
    include: { client: { select: { name: true, color: true } } },
  });
  return NextResponse.json(concept);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.concept.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
