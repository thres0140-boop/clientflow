import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/ai/db/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const competitor = await prisma.competitor.update({
    where: { id: parseInt(id) },
    data: {
      ...(body.handle !== undefined ? { handle: body.handle } : {}),
      ...(body.name !== undefined ? { name: body.name || null } : {}),
      ...(body.niche !== undefined ? { niche: body.niche || null } : {}),
      ...(body.tags !== undefined ? { tags: body.tags || null } : {}),
      ...(body.followerCount !== undefined ? { followerCount: body.followerCount ? parseInt(body.followerCount) : null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.profileUrl !== undefined ? { profileUrl: body.profileUrl || null } : {}),
    } as any,
  });
  return NextResponse.json(competitor);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.competitor.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
