import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { accessToken, igUserId } = conn;

  // First verify the token is valid and get the real user ID
  const meRes = await fetch(`https://graph.instagram.com/v21.0/me?fields=id,username`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meData = await meRes.json();

  if (meData.error) {
    console.error("Token check failed:", JSON.stringify(meData.error));
    return NextResponse.json(
      { error: `Token invalid: ${meData.error.message}`, code: meData.error.code },
      { status: 401 }
    );
  }

  const resolvedUserId = meData.id ?? igUserId;
  console.log("Resolved igUserId:", resolvedUserId, "stored:", igUserId, "username:", meData.username);

  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/me/conversations` +
      `?platform=instagram` +
      `&fields=id,participants,updated_time,snippet,unread_count` +
      `&limit=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();
    console.log("Conversations raw response:", JSON.stringify(data).slice(0, 500));

    if (data.error) {
      console.error("Instagram conversations error:", JSON.stringify(data.error));
      return NextResponse.json(
        { error: data.error.message, code: data.error.code, type: data.error.type, subcode: data.error.error_subcode },
        { status: 400 }
      );
    }

    const conversations = (data.data ?? []).map((conv: Record<string, unknown>) => {
      const participants = ((conv.participants as { data: { name: string; id: string; username?: string }[] })?.data) ?? [];
      const others = participants.filter((p) => p.id !== resolvedUserId);
      const person  = others[0] ?? participants[0] ?? null;

      return {
        id:           String(conv.id),
        name:         person?.name    ?? "Unknown",
        handle:       person?.username ?? null,
        igId:         person?.id       ?? null,
        updatedTime:  conv.updated_time as string,
        snippet:      conv.snippet     as string | null,
        unreadCount:  conv.unread_count as number | null,
      };
    });

    return NextResponse.json({ conversations, igUserId: resolvedUserId });
  } catch (err) {
    console.error("conversations error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
