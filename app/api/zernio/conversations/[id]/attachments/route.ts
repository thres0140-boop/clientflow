import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";

const ZERNIO_BASE = "https://zernio.com/api/v1";
const ZERNIO_KEY  = process.env.ZERNIO_API_KEY!;

// GET /api/zernio/conversations/[id]/attachments?clientId=X&messageId=Y&index=N
// Instagram attachment URLs are signed Meta CDN links that EXPIRE. Zernio re-mints them via
// GET /v1/inbox/conversations/{id}/messages/{messageId}/attachments/{index}?format=json
// (accountId is required or it 400s). The client calls this when an inline image/video fails
// to load, then renders the fresh url through /api/img or /api/vid.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: conversationId } = await params;
  const q = req.nextUrl.searchParams;
  const clientId = q.get("clientId"), messageId = q.get("messageId"), index = q.get("index");
  if (!clientId || !messageId || index == null) return NextResponse.json({ error: "clientId, messageId and index required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({ where: { clientId: parseInt(clientId) } });
  if (!conn?.zernioAccountId) return NextResponse.json({ error: "no_zernio_account" }, { status: 400 });

  const url = new URL(`${ZERNIO_BASE}/inbox/conversations/${conversationId}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(index)}`);
  url.searchParams.set("accountId", conn.zernioAccountId);
  url.searchParams.set("format", "json");
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${ZERNIO_KEY}`, Accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.url) return NextResponse.json({ error: data?.message ?? "attachment_unavailable" }, { status: 400 });
  return NextResponse.json({ url: data.url, refreshed: !!data.refreshed });
}
