import { NextRequest, NextResponse } from "next/server";
import { markSeen } from "@/features/instagram/server/inboxMirror";

// POST /api/zernio/conversations/[id]/seen  { clientId }
// The owner opened the thread → lastSeenAt = now on the mirror row, so only incoming messages
// newer than this moment count as unread. No-op (ok:false) when the thread isn't mirrored.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { clientId } = await req.json().catch(() => ({}));
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  const ok = await markSeen(parseInt(String(clientId)), id);
  return NextResponse.json({ ok });
}
