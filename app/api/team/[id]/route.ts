import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await prisma.teamMember.findUnique({ where: { id: parseInt(id) } });
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(member);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const member = await prisma.teamMember.update({
    where: { id: parseInt(id) },
    data: {
      name: body.name,
      email: body.email || null,
      role: body.role || null,
      color: body.color || "#6366f1",
      pageAccess: body.pageAccess || "all",
    },
  });
  return NextResponse.json(member);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.teamMember.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
