import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const member = await prisma.teamMember.findFirst({ where: { inviteToken: token } });
  if (!member) return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  if (member.inviteTokenExpiry && member.inviteTokenExpiry < new Date()) {
    return NextResponse.json({ error: "This invite link has expired" }, { status: 410 });
  }
  return NextResponse.json({ name: member.name, email: member.email });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { password } = await req.json();
  const member = await prisma.teamMember.findFirst({ where: { inviteToken: token } });
  if (!member) return NextResponse.json({ error: "Invalid invite link" }, { status: 404 });
  if (member.inviteTokenExpiry && member.inviteTokenExpiry < new Date()) {
    return NextResponse.json({ error: "This invite link has expired" }, { status: 410 });
  }
  const hash = await bcrypt.hash(password, 10);
  await prisma.teamMember.update({
    where: { id: member.id },
    data: { passwordHash: hash, inviteToken: null, inviteTokenExpiry: null },
  });
  return NextResponse.json({ ok: true });
}
