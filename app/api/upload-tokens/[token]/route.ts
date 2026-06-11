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
    editedVideoUrl: draft.editedVideoUrl,
    caption: draft.caption,
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

// POST /api/upload-tokens/[token] — advance the draft to the next stage (default), or
// with { action: "sendback", note } move it back a stage with feedback. Lets a reviewer
// approve-through or send-back straight from the phone review link, no login.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const draft = await prisma.scriptDraft.findUnique({ where: { uploadToken: token } });
  if (!draft) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const { stages } = await stageInfo(draft.clientId, draft.stageId ?? null);
  const idx = draft.stageId ? stages.findIndex((s) => s.id === draft.stageId) : -1;

  if (body?.action === "sendback") {
    const prev = idx > 0 ? stages[idx - 1] : null;
    const fromName = idx >= 0 ? stages[idx]?.name ?? "stage" : "stage";
    const toName = prev?.name ?? "Ideas";
    const reason = String(body.note || "").slice(0, 1000);
    await prisma.draftNote.create({
      data: { draftId: draft.id, content: `↩ Sent back (${fromName} → ${toName})${reason ? ": " + reason : ""}`, author: body.author || "Reviewer" },
    }).catch(() => {});
    await prisma.scriptDraft.update({
      where: { id: draft.id },
      data: { stageId: prev?.id ?? null, status: "pending", rejectionFeedback: reason || `Sent back from ${fromName}` },
    });
    return NextResponse.json({ ok: true, sentBackTo: toName });
  }

  // Default: advance to next stage.
  const next = idx >= 0 ? (stages[idx + 1] ?? null) : (stages[0] ?? null);
  if (!next) return NextResponse.json({ ok: true, done: true, message: "Already at the last stage." });
  await prisma.scriptDraft.update({
    where: { id: draft.id },
    data: { stageId: next.id, status: "accepted", rejectionFeedback: null },
  });
  return NextResponse.json({ ok: true, nextStage: next.name });
}
