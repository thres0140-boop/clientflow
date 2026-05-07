import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const notifs = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      member: { select: { name: true, color: true } },
      content: { select: { title: true, client: { select: { name: true } } } },
    },
  });
  return NextResponse.json(notifs);
}

export async function PUT(req: NextRequest) {
  // Mark all as read
  const body = await req.json();
  if (body.markAllRead) {
    await prisma.notification.updateMany({ data: { read: true } });
  } else if (body.id) {
    await prisma.notification.update({ where: { id: body.id }, data: { read: true } });
  }
  return NextResponse.json({ ok: true });
}
