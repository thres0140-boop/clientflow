import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const client = await prisma.client.update({
    where: { id: parseInt(id) },
    data: {
      name: body.name,
      platform: body.platform,
      profileUrl: body.profileUrl || null,
      color: body.color || "#6366f1",
      notes: body.notes || null,
      captionStyle: body.captionStyle !== undefined ? (body.captionStyle || null) : undefined,
      dayTemplate: body.dayTemplate !== undefined ? (body.dayTemplate || null) : undefined,
      bookingLink: body.bookingLink !== undefined ? (body.bookingLink || null) : undefined,
    },
  });
  return NextResponse.json(client);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.client.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
