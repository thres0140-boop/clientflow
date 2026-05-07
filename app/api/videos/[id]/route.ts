import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.trackedVideo.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
