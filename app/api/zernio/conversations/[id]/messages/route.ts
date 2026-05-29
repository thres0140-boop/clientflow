import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;

// GET  /api/zernio/conversations/[id]/messages?clientId=X  — fetch messages
// POST /api/zernio/conversations/[id]/messages             — send reply
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params;
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn?.zernioAccountId) {
    return NextResponse.json({ error: "no_zernio_account" }, { status: 400 });
  }

  const url = new URL(`${ZERNIO_BASE}/inbox/conversations/${conversationId}/messages`);
  url.searchParams.set("accountId", conn.zernioAccountId);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${ZERNIO_KEY}`,
      Accept: "application/json",
    },
  });

  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json({ error: data?.message ?? "Failed to fetch messages" }, { status: 400 });
  }

  return NextResponse.json(data);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params;
  const { clientId, message, recipientName, recipientHandle } = await req.json();
  if (!clientId || !message) {
    return NextResponse.json({ error: "clientId and message required" }, { status: 400 });
  }

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn?.zernioAccountId) {
    return NextResponse.json({ error: "no_zernio_account" }, { status: 400 });
  }

  const res = await fetch(`${ZERNIO_BASE}/inbox/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ZERNIO_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      accountId: conn.zernioAccountId,
      message,
    }),
  });

  const data = await res.json();

  if (res.ok) {
    // Auto-create or promote pipeline lead when coach replies to a DM
    const today = new Date().toISOString().slice(0, 10);
    const handle = recipientHandle || null;
    const name   = recipientName || "Instagram User";
    const cid    = parseInt(clientId);

    if (handle) {
      const existing = await prisma.dmLead.findFirst({ where: { clientId: cid, handle } });
      if (!existing) {
        await prisma.dmLead.create({ data: { clientId: cid, name, handle, status: "messaged", date: today } });
      }
      // don't downgrade status if already further along the pipeline
    } else {
      await prisma.dmLead.create({ data: { clientId: cid, name, handle: null, status: "messaged", date: today } });
    }
  }

  return NextResponse.json(data, { status: res.ok ? 200 : 400 });
}
