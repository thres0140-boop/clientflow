import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");

  const where: Record<string, unknown> = {};
  if (clientId) where.clientId = parseInt(clientId);
  if (from || to) {
    where.date = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  const entries = await prisma.analyticsEntry.findMany({
    where,
    include: { concept: { select: { id: true, name: true } } },
    orderBy: { date: "asc" },
  });

  return NextResponse.json(entries);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clientId, date, conceptId, ...fields } = body;

  if (!clientId || !date) {
    return NextResponse.json({ error: "clientId and date required" }, { status: 400 });
  }

  const entry = await prisma.analyticsEntry.upsert({
    where: { clientId_date: { clientId: parseInt(clientId), date } },
    create: {
      clientId: parseInt(clientId),
      date,
      conceptId: conceptId ? parseInt(conceptId) : null,
      views: parseInt(fields.views ?? 0) || 0,
      likes: parseInt(fields.likes ?? 0) || 0,
      shares: parseInt(fields.shares ?? 0) || 0,
      follows: parseInt(fields.follows ?? 0) || 0,
      messagesSent: parseInt(fields.messagesSent ?? 0) || 0,
      messagesAnswered: parseInt(fields.messagesAnswered ?? 0) || 0,
      linksSent: parseInt(fields.linksSent ?? 0) || 0,
      bookedCalls: parseInt(fields.bookedCalls ?? 0) || 0,
    },
    update: {
      conceptId: conceptId !== undefined ? (conceptId ? parseInt(conceptId) : null) : undefined,
      views: fields.views !== undefined ? (parseInt(fields.views) || 0) : undefined,
      likes: fields.likes !== undefined ? (parseInt(fields.likes) || 0) : undefined,
      shares: fields.shares !== undefined ? (parseInt(fields.shares) || 0) : undefined,
      follows: fields.follows !== undefined ? (parseInt(fields.follows) || 0) : undefined,
      messagesSent: fields.messagesSent !== undefined ? (parseInt(fields.messagesSent) || 0) : undefined,
      messagesAnswered: fields.messagesAnswered !== undefined ? (parseInt(fields.messagesAnswered) || 0) : undefined,
      linksSent: fields.linksSent !== undefined ? (parseInt(fields.linksSent) || 0) : undefined,
      bookedCalls: fields.bookedCalls !== undefined ? (parseInt(fields.bookedCalls) || 0) : undefined,
    },
    include: { concept: { select: { id: true, name: true } } },
  });

  return NextResponse.json(entry);
}
