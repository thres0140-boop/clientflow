import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const entry = await prisma.analyticsEntry.update({
    where: { id: parseInt(id) },
    data: {
      conceptId: body.conceptId !== undefined ? (body.conceptId ? parseInt(body.conceptId) : null) : undefined,
      views: body.views !== undefined ? (parseInt(body.views) || 0) : undefined,
      likes: body.likes !== undefined ? (parseInt(body.likes) || 0) : undefined,
      shares: body.shares !== undefined ? (parseInt(body.shares) || 0) : undefined,
      follows: body.follows !== undefined ? (parseInt(body.follows) || 0) : undefined,
      messagesSent: body.messagesSent !== undefined ? (parseInt(body.messagesSent) || 0) : undefined,
      messagesAnswered: body.messagesAnswered !== undefined ? (parseInt(body.messagesAnswered) || 0) : undefined,
      linksSent: body.linksSent !== undefined ? (parseInt(body.linksSent) || 0) : undefined,
      bookedCalls: body.bookedCalls !== undefined ? (parseInt(body.bookedCalls) || 0) : undefined,
    },
    include: { concept: { select: { id: true, name: true } } },
  });

  return NextResponse.json(entry);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.analyticsEntry.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
