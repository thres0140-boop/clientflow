import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addConceptExample, splitExamples, joinExamples } from "@/lib/conceptExamples";
import { sendWhatsApp } from "@/lib/notify";

export async function GET(req: NextRequest) {
  const idParam = req.nextUrl.searchParams.get("id");
  if (idParam) {
    const draft = await prisma.scriptDraft.findUnique({
      where: { id: parseInt(idParam) },
      include: { concept: { select: { name: true, conceptType: true } }, client: { select: { name: true, color: true } }, stage: true },
    });
    return NextResponse.json(draft);
  }

  const clientId = req.nextUrl.searchParams.get("clientId");
  const scheduled = req.nextUrl.searchParams.get("scheduled");
  const today = new Date().toISOString().slice(0, 10);

  const where: Record<string, unknown> = clientId ? { clientId: parseInt(clientId) } : {};

  const staged = req.nextUrl.searchParams.get("staged");
  const all = req.nextUrl.searchParams.get("all");

  if (scheduled === "true") {
    where.scheduledDate = { not: null };
    where.stageId = { not: null };
  } else if (staged === "true") {
    where.stageId = { not: null };
  } else if (all === "true") {
    // All drafts for the client (for Schedule Board — shows every script)
    where.isSavedIdea = false;
  } else {
    where.OR = [
      { status: "pending" },
      { status: "saved", resurfaceAt: { lte: today } },
      { status: { in: ["accepted"] }, stageId: { not: null } },
    ];
  }

  const drafts = await prisma.scriptDraft.findMany({
    where,
    orderBy: [{ isSavedIdea: "asc" }, { generatedAt: "desc" }],
    include: {
      concept: { select: { name: true, conceptType: true } },
      client: { select: { name: true, color: true } },
      stage: true,
    },
  });
  return NextResponse.json(drafts);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const draft = await prisma.scriptDraft.create({
    data: {
      clientId: parseInt(body.clientId),
      conceptId: parseInt(body.conceptId),
      title: body.title,
      hook: body.hook || null,
      script: body.script,
      caption: body.caption || null,
      weekLabel: body.weekLabel,
      dayLabel: body.dayLabel || null,
      status: "pending",
      isSavedIdea: false,
      clientAuthored: body.clientAuthored === true,
    },
    include: {
      concept: { select: { name: true, conceptType: true } },
      client: { select: { name: true, color: true } },
    },
  });

  // Imported scripts can seed the concept's AI Context: append to the concept's
  // example scripts (deduped) + the provenance pool, so the generator learns
  // this script belongs to this concept.
  if (body.seedAsExample === true && draft.conceptId && draft.script) {
    try {
      const concept = await prisma.concept.findUnique({ where: { id: draft.conceptId } });
      const existing = splitExamples(concept?.scriptExamples);
      if (!existing.some((e) => e.toLowerCase() === draft.script.trim().toLowerCase())) {
        const updated = joinExamples([...existing, draft.script.trim()]);
        await prisma.concept.update({ where: { id: draft.conceptId }, data: { scriptExamples: updated } });
      }
      await addConceptExample(draft.conceptId, draft.script, "human_seed", { scriptDraftId: draft.id }).catch(() => {});
    } catch { /* non-fatal */ }
  }

  // WhatsApp the owner when a client submits a self-written script.
  if (body.clientAuthored === true && draft.script) {
    const concept = draft.concept ? `${draft.concept.conceptType ? `${draft.concept.conceptType} · ` : ""}${draft.concept.name}` : "a concept";
    const who = draft.client?.name || "Client";
    sendWhatsApp(`📝 ${who} submitted a script for ${concept}`).catch(() => {});
  }

  return NextResponse.json(draft, { status: 201 });
}
