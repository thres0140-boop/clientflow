import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const scheduled = req.nextUrl.searchParams.get("scheduled");
  const today = new Date().toISOString().slice(0, 10);

  const where: Record<string, unknown> = clientId ? { clientId: parseInt(clientId) } : {};

  const staged = req.nextUrl.searchParams.get("staged");

  if (scheduled === "true") {
    where.scheduledDate = { not: null };
    where.stageId = { not: null };
  } else if (staged === "true") {
    // All drafts currently in a stage (scheduled or not)
    where.stageId = { not: null };
  } else {
    // Only show pending/saved drafts; saved ideas only if resurfaceAt <= today
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
