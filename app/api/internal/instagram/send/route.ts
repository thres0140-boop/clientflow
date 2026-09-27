import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { INTERNAL_TOKEN_HEADER, isInternalToken } from "@/shared/auth/internalToken";
import { POST as sendConversationMessage } from "@/app/api/zernio/conversations/[id]/messages/route";

export const runtime = "nodejs";

// POST /api/internal/instagram/send   header x-ordo-internal-token: <INTERNAL_API_SECRET>
//   { clientId: number, conversationId: string, message: string }
//
// Service-to-service entry point for Cenks Dashboard's DM Inbox. It does not send anything
// itself: it hands the request to the exact handler the Instagram Inbox composer calls
// (POST /api/zernio/conversations/[id]/messages), with the same recipientName/recipientHandle
// the inbox would pass, so Zernio, the mirror's touchOutgoing and the pipeline-lead upsert all
// behave as if the coach had replied from Ordo. Text only.
const MAX_LENGTH = 1000; // Instagram's DM text limit
const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Same label the Instagram Inbox shows (DmsPage threadLabel), which it sends as recipientName.
const PLACEHOLDER_NAME = "Instagram User";
function anonSuffix(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36).toUpperCase().padStart(4, "0").slice(-4);
}
function threadLabel(c: { participantName: string | null; participantUsername: string | null; participantId: string | null }) {
  if (c.participantName && c.participantName.trim() !== PLACEHOLDER_NAME) return c.participantName;
  if (c.participantUsername) return `@${c.participantUsername}`;
  if (c.participantId) return `Instagram user · ${anonSuffix(c.participantId)}`;
  return PLACEHOLDER_NAME;
}

export async function POST(req: NextRequest) {
  if (!isInternalToken(req.headers.get(INTERNAL_TOKEN_HEADER))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as { clientId?: unknown; conversationId?: unknown; message?: unknown } | null;
  const clientId = typeof body?.clientId === "number" && Number.isInteger(body.clientId) ? body.clientId : null;
  const conversationId = typeof body?.conversationId === "string" && CONVERSATION_ID_RE.test(body.conversationId) ? body.conversationId : null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!clientId || !conversationId || !message) {
    return NextResponse.json({ error: "clientId, conversationId and message are required" }, { status: 400 });
  }
  if (message.length > MAX_LENGTH) return NextResponse.json({ error: `message longer than ${MAX_LENGTH} characters` }, { status: 400 });

  // The conversation must belong to this coach: never send from one coach's account into a
  // thread of another's, whatever the caller passes.
  const rows = await prisma.$queryRawUnsafe<{ participantName: string | null; participantUsername: string | null; participantId: string | null }[]>(
    `SELECT "participantName", "participantUsername", "participantId" FROM "ZernioConversation" WHERE id = $1 AND "clientId" = $2 LIMIT 1`,
    conversationId, clientId,
  );
  const conv = rows[0];
  if (!conv) return NextResponse.json({ error: "conversation not found for this client" }, { status: 404 });

  const forward = new NextRequest(new URL(`/api/zernio/conversations/${conversationId}/messages`, req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, message, recipientName: threadLabel(conv), recipientHandle: conv.participantUsername || null }),
  });
  const res = await sendConversationMessage(forward, { params: Promise.resolve({ id: conversationId }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: data?.error ?? data?.message ?? "send failed" }, { status: res.status === 400 ? 502 : res.status });
  }
  return NextResponse.json({ ok: true, sentAt: new Date().toISOString(), result: data });
}
