import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addConceptExample } from "@/lib/conceptExamples";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await prisma.scriptDraft.findUnique({
    where: { id: parseInt(id) },
    include: {
      concept: { select: { name: true, conceptType: true } },
      client: { select: { name: true, color: true } },
      stage: true,
    },
  });
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(draft);
}

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
  if (body.rawContentUrl !== undefined) data.rawContentUrl = body.rawContentUrl;
  if (body.rawContentUrls !== undefined) data.rawContentUrls = JSON.stringify(body.rawContentUrls);
  if (body.editedVideoUrl !== undefined) data.editedVideoUrl = body.editedVideoUrl || null;
  if (body.checkReviewerIds !== undefined) data.checkReviewerIds = JSON.stringify(body.checkReviewerIds);
  if (body.scheduledDate !== undefined) data.scheduledDate = body.scheduledDate || null;

  // Detect acceptance: a draft entering a stage for the first time (Ideas → pipeline).
  let prevStageId: number | null | undefined = undefined;
  if (body.stageId !== undefined && data.stageId) {
    const prev = await prisma.scriptDraft.findUnique({ where: { id: parseInt(id) }, select: { stageId: true } });
    prevStageId = prev?.stageId ?? null;
  }

  const draft = await prisma.scriptDraft.update({
    where: { id: parseInt(id) },
    data,
    include: {
      concept: { select: { name: true, conceptType: true } },
      client: { select: { name: true, color: true } },
      stage: true,
    },
  });

  // On first acceptance into the pipeline, add the script to the concept's example
  // pool as an accepted-but-unproven draft (labeled recent context, not canon).
  if (prevStageId === null && data.stageId && draft.conceptId && draft.script) {
    addConceptExample(draft.conceptId, draft.script, "accepted_draft", { scriptDraftId: draft.id }).catch(() => {});
  }

  return NextResponse.json(draft);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.scriptDraft.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
