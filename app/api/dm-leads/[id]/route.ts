import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bumpAnalytics, todayYMD } from "@/lib/analyticsBump";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  // Read previous status so we only count a transition once
  const prev = await prisma.dmLead.findUnique({ where: { id: parseInt(id) } });

  const lead = await prisma.dmLead.update({
    where: { id: parseInt(id) },
    data: {
      name:   body.name   !== undefined ? body.name              : undefined,
      handle: body.handle !== undefined ? (body.handle || null)  : undefined,
      status: body.status !== undefined ? body.status            : undefined,
      date:   body.date   !== undefined ? (body.date   || null)  : undefined,
      notes:  body.notes  !== undefined ? (body.notes  || null)  : undefined,
      ...(body.repliedAt !== undefined ? { repliedAt: body.repliedAt || null } : {}),
      ...(body.source !== undefined ? { source: body.source || null } : {}),
    } as any,
  });

  // Auto-fill analytics on the day a status transition happens
  if (body.status !== undefined && prev && prev.status !== body.status) {
    if (body.status === "link_sent") bumpAnalytics(lead.clientId, "linksSent", todayYMD());
    if (body.status === "booked")    bumpAnalytics(lead.clientId, "bookedCalls", todayYMD());
  }

  // First time a reply is recorded → count it as an answered message
  if (body.repliedAt && prev && !(prev as any).repliedAt) {
    bumpAnalytics(lead.clientId, "messagesAnswered", todayYMD());
  }

  return NextResponse.json(lead);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.dmLead.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
