import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await (prisma as any).instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { accessToken, igUserId } = conn;

  // Check token permissions (for debug info only, not blocking)
  const permRes = await fetch(
    `https://graph.instagram.com/v21.0/me/permissions`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const permData = await permRes.json();
  const grantedPerms: string[] = (permData.data ?? [])
    .filter((p: { permission: string; status: string }) => p.status === "granted")
    .map((p: { permission: string }) => p.permission);

  // Verify token
  const meRes = await fetch(`https://graph.instagram.com/v21.0/me?fields=id,username`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meData = await meRes.json();
  if (meData.error) {
    return NextResponse.json({ error: `Token invalid: ${meData.error.message}`, code: meData.error.code }, { status: 401 });
  }

  const resolvedUserId = meData.id ?? igUserId;

  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/me/conversations?fields=id,participants,updated_time,snippet,unread_count&platform=instagram&limit=20`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();

    if (data.error) {
      return NextResponse.json(
        { error: data.error.message, code: data.error.code, type: data.error.type, grantedScopes: grantedPerms },
        { status: 400 }
      );
    }

    // Debug: return raw if empty
    if (!data.data || data.data.length === 0) {
      return NextResponse.json({ conversations: [], igUserId: resolvedUserId, grantedScopes: grantedPerms, _raw: data });
    }

    const conversations = (data.data ?? []).map((conv: Record<string, unknown>) => {
      const participants = ((conv.participants as { data: { name: string; id: string; username?: string }[] })?.data) ?? [];
      const others = participants.filter((p) => p.id !== resolvedUserId);
      const person = others[0] ?? participants[0] ?? null;
      return {
        id:          String(conv.id),
        name:        person?.name    ?? "Unknown",
        handle:      person?.username ?? null,
        igId:        person?.id       ?? null,
        updatedTime: conv.updated_time as string,
        snippet:     conv.snippet     as string | null,
        unreadCount: conv.unread_count as number | null,
      };
    });

    return NextResponse.json({ conversations, igUserId: resolvedUserId, grantedScopes: grantedPerms });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
