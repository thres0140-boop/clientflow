import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/session";
import { sendWhatsApp } from "@/lib/notify";
import { sendPush } from "@/lib/push";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json([]);

  // A logged-in member may only read their OWN thread — a client the "client"
  // channel, an editor/teammate their member channel. The owner sees everything.
  let allowedChannel: string | null = null;
  const token = req.cookies.get("cf_session")?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (session?.type === "member" && session.memberId != null) {
    // A member can have a different record id per project (shared-email grouping), so
    // resolve their channel from the record FOR THIS client, not the login record —
    // otherwise their chat is empty on every project except the one they logged into.
    const me = await prisma.teamMember.findUnique({ where: { id: session.memberId }, select: { email: true, isClientAccount: true } });
    let projMember: { id: number; isClientAccount: boolean } | null = null;
    if (me?.email) {
      projMember = await prisma.teamMember.findFirst({
        where: { clientId: parseInt(clientId), email: { equals: me.email, mode: "insensitive" } },
        select: { id: true, isClientAccount: true },
      });
    }
    if (projMember) {
      allowedChannel = projMember.isClientAccount ? "client" : `member:${projMember.id}`;
    } else {
      allowedChannel = me?.isClientAccount ? "client" : `member:${session.memberId}`;
    }
  }

  // ?summary=1 → latest message per channel (for unread badges + WhatsApp-style sorting)
  if (req.nextUrl.searchParams.get("summary") === "1") {
    const all = await prisma.message.findMany({
      where: { clientId: parseInt(clientId), ...(allowedChannel ? { channel: allowedChannel } : {}) },
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
  // Block members from reading any channel that isn't theirs.
  if (allowedChannel && channel !== allowedChannel) return NextResponse.json([]);
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

  // Notify the other side (WhatsApp + web push). Best-effort, never blocks the send.
  try {
    const token = req.cookies.get("cf_session")?.value;
    const session = token ? await verifySessionToken(token) : null;
    const cid = body.clientId ? parseInt(body.clientId) : null;
    const client = cid ? await prisma.client.findUnique({ where: { id: cid }, select: { name: true } }) : null;
    const preview = String(body.content || "").replace(/^__REEL__.*?__END__/, "🎬 ").slice(0, 140);
    if (session && session.type === "member") {
      // A client/editor messaged → alert the owner.
      const sender = session.name || "Someone";
      sendWhatsApp(`💬 New message from ${sender}${client ? ` · ${client.name}` : ""}:\n${preview}`).catch(() => {});
      sendPush({ subscriberType: "owner" }, { title: `💬 ${sender}${client ? ` · ${client.name}` : ""}`, body: preview, url: "/" }).catch(() => {});
    } else if (session && session.type === "owner" && cid) {
      // Owner messaged → push the client's members (their installed app).
      sendPush({ subscriberType: "member", clientId: cid }, { title: "💬 New message", body: preview, url: "/" }).catch(() => {});
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
