import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { accessToken, igUserId } = conn;

  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/${id}/messages` +
      `?fields=id,message,from,created_time,attachments` +
      `&limit=50`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();

    if (data.error) {
      return NextResponse.json({ error: data.error.message, code: data.error.code }, { status: 400 });
    }

    const messages = (data.data ?? []).map((msg: Record<string, unknown>) => ({
      id:          String(msg.id),
      text:        (msg.message as string) ?? "",
      fromId:      ((msg.from as Record<string, string>)?.id) ?? "",
      fromName:    ((msg.from as Record<string, string>)?.name) ?? "",
      isOwn:       ((msg.from as Record<string, string>)?.id) === igUserId,
      createdTime: msg.created_time as string,
    })).reverse(); // oldest first for chat display

    return NextResponse.json({ messages, igUserId });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
