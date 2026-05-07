import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const members = await prisma.teamMember.findMany({
    orderBy: { name: "asc" },
  });
  return NextResponse.json(members);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const member = await prisma.teamMember.create({
    data: {
      name: body.name,
      email: body.email || null,
      role: body.role || null,
      color: body.color || "#6366f1",
      pageAccess: body.pageAccess || "all",
    },
  });
  return NextResponse.json(member, { status: 201 });
}
