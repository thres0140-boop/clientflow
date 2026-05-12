import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

  return NextResponse.json({
    id: draft.id,
    title: draft.title,
    hook: draft.hook,
    script: draft.script,
    clientName: draft.client.name,
    clientColor: draft.client.color,
    conceptName: draft.concept?.name ?? null,
    rawContentUrls: draft.rawContentUrls,
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
