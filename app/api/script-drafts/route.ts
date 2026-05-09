import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const idParam = req.nextUrl.searchParams.get("id");
  if (idParam) {
    const draft = await prisma.scriptDraft.findUnique({
      where: { id: parseInt(idParam) },
      include: { concept: { select: { name: true } }, client: { select: { name: true, color: true } }, stage: true },
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
      concept: { select: { name: true } },
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
    },
    include: {
      concept: { select: { name: true } },
      client: { select: { name: true, color: true } },
    },
  });
  return NextResponse.json(draft, { status: 201 });
}
