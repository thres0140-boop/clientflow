import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const conceptId = req.nextUrl.searchParams.get("conceptId");

  const where: Record<string, unknown> = {};
  if (clientId) where.clientId = parseInt(clientId);
  if (conceptId) where.conceptId = parseInt(conceptId);

  const feedbacks = await prisma.conceptFeedback.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      concept: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json(feedbacks);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const feedback = await prisma.conceptFeedback.create({
    data: {
      conceptId: parseInt(body.conceptId),
      clientId: parseInt(body.clientId),
      title: body.title,
      hook: body.hook || null,
      scriptSnippet: body.scriptSnippet || null,
      reasonType: body.reasonType,
      reason: body.reason || null,
    },
  });
  return NextResponse.json(feedback, { status: 201 });
}
