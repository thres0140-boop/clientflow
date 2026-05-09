import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const BASE = `https://${process.env.UNIPILE_DSN}/api/v1`;
const KEY  = process.env.UNIPILE_API_KEY!;

export async function POST(req: NextRequest) {
  const { clientId, chatId, text } = await req.json();

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });
  if (!conn?.unipileAccountId) {
    return NextResponse.json({ error: "no_unipile_account" }, { status: 400 });
  }

  const res = await fetch(`${BASE}/chats/${chatId}/messages`, {
    method: "POST",
    headers: {
      "X-API-KEY": KEY,
      "Content-Type": "application/json",
      "accept": "application/json",
    },
    body: JSON.stringify({ text, account_id: conn.unipileAccountId }),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.ok ? 200 : 400 });
}
