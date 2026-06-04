import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import { sendWhatsApp } from "@/lib/notify";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json([]);

  // ?summary=1 → latest message per channel (for unread badges + WhatsApp-style sorting)
  if (req.nextUrl.searchParams.get("summary") === "1") {
    const all = await prisma.message.findMany({
      where: { clientId: parseInt(clientId) },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    const map: Record<string, { channel: string; lastAt: Date; lastAuthor: string; lastContent: string }> = {};
    for (const m of all) {
      if (!map[m.channel]) map[m.channel] = { channel: m.channel, lastAt: m.createdAt, lastAuthor: m.author, lastContent: (m.content || "").slice(0, 60) };
    }
    return NextResponse.json(Object.values(map));
  }

  const channel = req.nextUrl.searchParams.get("channel") ?? "client";
  const messages = await prisma.message.findMany({
    where: { clientId: parseInt(clientId), channel },
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
      channel: body.channel || "client",
    },
  });

  // WhatsApp the owner when a client/team member messages them (not the owner's own sends).
  try {
    const token = req.cookies.get("cf_session")?.value;
    const session = token ? await verifySessionToken(token) : null;
    if (session && session.type === "member") {
      const sender = session.name || "Someone";
      const client = body.clientId ? await prisma.client.findUnique({ where: { id: parseInt(body.clientId) }, select: { name: true } }) : null;
      const preview = String(body.content || "").replace(/^__REEL__.*?__END__/, "🎬 ").slice(0, 140);
      sendWhatsApp(`💬 New message from ${sender}${client ? ` · ${client.name}` : ""}:\n${preview}`).catch(() => {});
    }
  } catch { /* non-fatal */ }

  return NextResponse.json(message, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.message.delete({ where: { id: parseInt(id) } });
  return NextResponse.json({ ok: true });
}
