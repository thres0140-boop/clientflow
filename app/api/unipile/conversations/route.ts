import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const BASE = `https://${process.env.UNIPILE_DSN}/api/v1`;
const KEY  = process.env.UNIPILE_API_KEY!;

function headers() {
  return { "X-API-KEY": KEY, "accept": "application/json" };
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  const conn = await prisma.instagramConnection.findUnique({
    where: { clientId: parseInt(clientId) },
  });

  if (!conn?.unipileAccountId) {
    return NextResponse.json({ error: "no_unipile_account", conversations: [] });
  }

  // Fetch chats for this account
  const res = await fetch(
    `${BASE}/chats?account_id=${conn.unipileAccountId}&limit=50`,
    { headers: headers() }
  );
  const data = await res.json();

  return NextResponse.json({ conversations: data.items ?? data.chats ?? [] });
}
