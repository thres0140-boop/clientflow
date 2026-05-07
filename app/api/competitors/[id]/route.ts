import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const competitor = await prisma.competitor.update({
    where: { id: parseInt(id) },
    data: {
      handle: body.handle,
      name: body.name || null,
      niche: body.niche || null,
      followerCount: body.followerCount ? parseInt(body.followerCount) : null,
      notes: body.notes || null,
      profileUrl: body.profileUrl || null,
    },
  });
  return NextResponse.json(competitor);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.competitor.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
