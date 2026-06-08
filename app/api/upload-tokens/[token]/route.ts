import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Ordered stages for a client + the stage that comes after `stageId`.
async function stageInfo(clientId: number, stageId: number | null) {
  const stages = await prisma.workflowStage.findMany({ where: { clientId }, orderBy: { order: "asc" } });
  const idx = stageId ? stages.findIndex((s) => s.id === stageId) : -1;
  const current = idx >= 0 ? stages[idx] : null;
  const next = idx >= 0 ? (stages[idx + 1] ?? null) : (stages[0] ?? null);
  return { stages, current, next };
}

// GET /api/upload-tokens/[token] — validate token, return draft info for mobile page
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const draft = await prisma.scriptDraft.findUnique({
    where: { uploadToken: token },
    include: {
      client: { select: { name: true, color: true } },
      concept: { select: { name: true } },
    },
  });
  if (!draft) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });

  const { current, next } = await stageInfo(draft.clientId, draft.stageId ?? null);

  return NextResponse.json({
    id: draft.id,
    title: draft.title,
    hook: draft.hook,
    script: draft.script,
    clientName: draft.client.name,
    clientColor: draft.client.color,
    conceptName: draft.concept?.name ?? null,
    rawContentUrls: draft.rawContentUrls,
    stageName: current?.name ?? null,
    nextStageName: next?.name ?? null,
  });
}

// PATCH /api/upload-tokens/[token] — append a new uploaded URL to the draft
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { url } = await req.json();
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  const draft = await prisma.scriptDraft.findUnique({ where: { uploadToken: token } });
  if (!draft) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const existing: string[] = JSON.parse(draft.rawContentUrls || "[]");
  const updated = [...existing, url];

  await prisma.scriptDraft.update({
    where: { id: draft.id },
    data: { rawContentUrls: JSON.stringify(updated) },
  });

  return NextResponse.json({ ok: true, urls: updated });
}

// POST /api/upload-tokens/[token] — advance the draft to the next workflow stage
// (so the recorder can push it forward straight from their phone after uploading).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const draft = await prisma.scriptDraft.findUnique({ where: { uploadToken: token } });
  if (!draft) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const { next } = await stageInfo(draft.clientId, draft.stageId ?? null);
  if (!next) return NextResponse.json({ ok: true, done: true, message: "Already at the last stage." });

  await prisma.scriptDraft.update({
    where: { id: draft.id },
    data: { stageId: next.id, status: "accepted" },
  });

  return NextResponse.json({ ok: true, nextStage: next.name });
}
