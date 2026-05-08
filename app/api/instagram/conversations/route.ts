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

  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/${igUserId}/conversations` +
      `?platform=instagram` +
      `&fields=id,participants,updated_time,snippet,unread_count` +
      `&limit=50` +
      `&access_token=${accessToken}`
    );
    const data = await res.json();

    if (data.error) {
      return NextResponse.json(
        { error: data.error.message, code: data.error.code, type: data.error.type },
        { status: 400 }
      );
    }

    const conversations = (data.data ?? []).map((conv: Record<string, unknown>) => {
      const participants = ((conv.participants as { data: { name: string; id: string; username?: string }[] })?.data) ?? [];
      // Filter out the business account itself — we want the other person
      const others = participants.filter((p) => p.id !== igUserId);
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

    return NextResponse.json({ conversations, igUserId });
  } catch (err) {
    console.error("conversations error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
