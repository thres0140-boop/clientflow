import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const lead = await prisma.dmLead.update({
    where: { id: parseInt(id) },
    data: {
      name:   body.name   !== undefined ? body.name              : undefined,
      handle: body.handle !== undefined ? (body.handle || null)  : undefined,
      status: body.status !== undefined ? body.status            : undefined,
      date:   body.date   !== undefined ? (body.date   || null)  : undefined,
      notes:  body.notes  !== undefined ? (body.notes  || null)  : undefined,
    },
  });
  return NextResponse.json(lead);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.dmLead.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
