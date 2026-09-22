import { NextRequest, NextResponse } from "next/server";
import { fetchOfficial, disconnectTikTok } from "@/lib/tiktokOAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/tiktok/official?clientId= — first-party profile + videos for a connected client.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ connected: false, profile: null, videos: [] });
  const data = await fetchOfficial(parseInt(clientId));
  return NextResponse.json(data);
}

// DELETE /api/tiktok/official?clientId= — disconnect the account.
export async function DELETE(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  await disconnectTikTok(parseInt(clientId));
  return NextResponse.json({ ok: true });
}
