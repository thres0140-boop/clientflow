import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  const creators = await prisma.creator.findMany({
    where: clientId ? { clientId: parseInt(clientId) } : {},
    include: { client: { select: { name: true, color: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(creators);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const creator = await prisma.creator.create({
    data: {
      clientId: parseInt(body.clientId),
      name: body.name,
      email: body.email || null,
      instagramHandle: body.instagramHandle || null,
      color: body.color || "#6366f1",
      notes: body.notes || null,
    },
    include: { client: { select: { name: true, color: true } } },
  });
  return NextResponse.json(creator, { status: 201 });
}
