import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json([]);
  const messages = await prisma.message.findMany({
    where: { clientId: parseInt(clientId) },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(messages);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message = await prisma.message.create({
    data: {
      clientId: parseInt(body.clientId),
      content: body.content,
      author: body.author || "owner",
    },
  });
  return NextResponse.json(message, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.message.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
