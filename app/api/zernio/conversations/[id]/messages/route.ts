import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { touchOutgoing } from "@/features/instagram/server/inboxMirror";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;

// GET  /api/zernio/conversations/[id]/messages?clientId=X&limit=50&cursor=…&sortOrder=desc
//      Passes Zernio's paging straight through (limit ≤ 100, default here 50, newest first) and
//      returns { messages, pagination: { hasMore, nextCursor } } so the client can load older
//      messages on scroll-up. Zernio's own default is 100/asc with no cursor followed — which is
//      why long conversations used to be cut off.
// POST /api/zernio/conversations/[id]/messages  — send reply (text, optionally one attachment by URL)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params;
  const q = req.nextUrl.searchParams;
  const clientId = q.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({ where: { clientId: parseInt(clientId) } });
  if (!conn?.zernioAccountId) return NextResponse.json({ error: "no_zernio_account" }, { status: 400 });

  const url = new URL(`${ZERNIO_BASE}/inbox/conversations/${conversationId}/messages`);
  url.searchParams.set("accountId", conn.zernioAccountId);
  url.searchParams.set("limit", String(Math.min(100, Math.max(1, parseInt(q.get("limit") || "50") || 50))));
  url.searchParams.set("sortOrder", q.get("sortOrder") === "asc" ? "asc" : "desc");
  const cursor = q.get("cursor");
  if (cursor) url.searchParams.set("cursor", cursor);

  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" } });
  const data = await res.json();
  if (!res.ok) {
    return NextResponse.json({ error: data?.message ?? "Failed to fetch messages" }, { status: 400 });
  }
  return NextResponse.json({
    messages: Array.isArray(data?.messages) ? data.messages : [],
    pagination: { hasMore: !!data?.pagination?.hasMore, nextCursor: data?.pagination?.nextCursor ?? null },
    sortOrderApplied: data?.sortOrderApplied ?? null,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: conversationId } = await params;
  const { clientId, message, recipientName, recipientHandle, attachmentUrl, attachmentType } = await req.json();
  if (!clientId || (!message && !attachmentUrl)) {
    return NextResponse.json({ error: "clientId and message (or attachmentUrl) required" }, { status: 400 });
  }

  const conn = await prisma.instagramConnection.findUnique({ where: { clientId: parseInt(clientId) } });
  if (!conn?.zernioAccountId) return NextResponse.json({ error: "no_zernio_account" }, { status: 400 });

  const body: Record<string, unknown> = { accountId: conn.zernioAccountId };
  if (message) body.message = message;
  // Zernio sends a media attachment from a public URL (our R2 public base). Types per its spec.
  if (attachmentUrl && ["image", "video", "audio", "file"].includes(String(attachmentType))) {
    body.attachmentUrl = attachmentUrl;
    body.attachmentType = attachmentType;
  }

  const res = await fetch(`${ZERNIO_BASE}/inbox/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${ZERNIO_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (res.ok) {
    // Mirror: we just sent → the thread's unread badge clears now, not at the next reconcile.
    touchOutgoing(parseInt(clientId), conversationId).catch(() => {});

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
