import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function maybe(val: unknown) {
  return val !== undefined ? (val || null) : undefined;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const concept = await prisma.concept.update({
    where: { id: parseInt(id) },
    data: {
      ...(body.clientId !== undefined ? { clientId: body.clientId ? parseInt(body.clientId) : null } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      conceptType: maybe(body.conceptType),
      hookType: maybe(body.hookType),
      textHook: maybe(body.textHook),
      audioHook: maybe(body.audioHook),
      videoType: maybe(body.videoType),
      angle: maybe(body.angle),
      structure: maybe(body.structure),
      guidelines: maybe(body.guidelines),
      exampleUrl: maybe(body.exampleUrl),
      scriptExamples: maybe(body.scriptExamples),
      scriptRules: maybe(body.scriptRules),
      notes: maybe(body.notes),
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
