import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clientId, recipientId, text } = body;

  if (!clientId || !recipientId || !text) {
    return NextResponse.json({ error: "clientId, recipientId and text required" }, { status: 400 });
  }

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { accessToken, igUserId } = conn;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${igUserId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message:   { text },
        }),
      }
    );
    const data = await res.json();

    if (data.error) {
      return NextResponse.json({ error: data.error.message, code: data.error.code }, { status: 400 });
    }

    return NextResponse.json({ ok: true, messageId: data.message_id });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
