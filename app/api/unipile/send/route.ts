import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const BASE = `https://${process.env.UNIPILE_DSN}/api/v1`;
const KEY  = process.env.UNIPILE_API_KEY!;

export async function POST(req: NextRequest) {
  const { clientId, chatId, text, recipientName, recipientHandle } = await req.json();
  const cid = parseInt(clientId);

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: cid },
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

  if (res.ok) {
    // Auto-create or promote pipeline lead when coach sends a DM
    const today = new Date().toISOString().slice(0, 10);
    const handle = recipientHandle || null;
    const name = recipientName || "Instagram User";
    console.log(`[send] upsert lead clientId=${cid} handle=${handle} name=${name}`);

    if (handle) {
      const existing = await prisma.dmLead.findFirst({ where: { clientId: cid, handle } });
      if (existing) {
        if (existing.status === "follows") {
          await prisma.dmLead.update({ where: { id: existing.id }, data: { status: "messaged" } });
        }
      } else {
        await prisma.dmLead.create({ data: { clientId: cid, name, handle, status: "messaged", date: today } });
      }
    } else {
      await prisma.dmLead.create({ data: { clientId: cid, name, handle: null, status: "messaged", date: today } });
    }
  }

  return NextResponse.json(data, { status: res.ok ? 200 : 400 });
}
