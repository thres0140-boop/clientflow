import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const creator = await prisma.creator.update({
    where: { id: parseInt(id) },
    data: {
      name: body.name,
      email: body.email || null,
      instagramHandle: body.instagramHandle || null,
      color: body.color || "#6366f1",
      notes: body.notes || null,
    },
  });
  return NextResponse.json(creator);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.creator.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
