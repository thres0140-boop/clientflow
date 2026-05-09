import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" });

  const conn = await (prisma as any).instagramConnection.findUnique({ where: { clientId: parseInt(clientId) } });
  if (!conn) return NextResponse.json({ error: "not connected" });

  const { accessToken, igUserId } = conn;

  const [meRaw, scopesRaw, convsRaw] = await Promise.all([
    fetch(`https://graph.instagram.com/v21.0/me?fields=id,username`, { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json()),
    fetch(`https://graph.instagram.com/v21.0/me/permissions`, { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json()),
    fetch(`https://graph.instagram.com/v21.0/me/conversations?fields=id,participants,updated_time,snippet,unread_count&limit=5`, { headers: { Authorization: `Bearer ${accessToken}` } }).then(r => r.json()),
  ]);

  return NextResponse.json({ storedIgUserId: igUserId, me: meRaw, scopes: scopesRaw, conversations: convsRaw });
}
