import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { todayYMD } from "@/lib/analyticsBump";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const prev = await prisma.dmLead.findUnique({ where: { id: parseInt(id) } });

  // When a status transition happens (e.g. manual drag), stamp the relevant date field
  // so the funnel analytics — computed from these dates — reflects the move on today's date.
  const stamp: any = {};
  if (body.status !== undefined && prev && prev.status !== body.status) {
    const now = new Date().toISOString();
    if (body.status === "answered"  && !(prev as any).repliedAt)  stamp.repliedAt  = todayYMD();
    if (body.status === "link_sent" && !(prev as any).linkSentAt) stamp.linkSentAt = now;
    if (body.status === "booked"    && !(prev as any).bookedAt)   stamp.bookedAt   = todayYMD();
  }

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
      ...stamp,
    } as any,
  });

  return NextResponse.json(lead);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.dmLead.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
