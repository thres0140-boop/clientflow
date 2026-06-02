import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const isIdea = req.nextUrl.searchParams.get("isIdea");
  const where: Record<string, unknown> = clientId
    ? { OR: [{ clientId: parseInt(clientId) }, { clientId: null }] }
    : {};
  if (isIdea !== null) where.isIdea = isIdea === "true";
  const concepts = await prisma.concept.findMany({
    where,
    include: { client: { select: { name: true, color: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(concepts);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const concept = await prisma.concept.create({
    data: {
      clientId: body.clientId ? parseInt(body.clientId) : null,
      name: body.name,
      conceptType: body.conceptType || null,
      reelUrls: body.reelUrls ? (typeof body.reelUrls === "string" ? body.reelUrls : JSON.stringify(body.reelUrls)) : null,
      textOverlay: body.textOverlay === true,
      clientOwned: body.clientOwned === true,
      clientQuota: body.clientQuota != null && body.clientQuota !== "" ? parseInt(body.clientQuota) : null,
      clientIntervalDays: body.clientIntervalDays != null && body.clientIntervalDays !== "" ? parseInt(body.clientIntervalDays) : null,
      clientAnchor: body.clientAnchor || null,
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
      isIdea: body.isIdea === true,
    } as any,
    include: { client: { select: { name: true, color: true } } },
  });
  return NextResponse.json(concept, { status: 201 });
}
