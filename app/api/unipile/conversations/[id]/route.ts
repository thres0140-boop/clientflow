import { NextRequest, NextResponse } from "next/server";

const BASE = `https://${process.env.UNIPILE_DSN}/api/v1`;
const KEY  = process.env.UNIPILE_API_KEY!;

function headers() {
  return { "X-API-KEY": KEY, "accept": "application/json" };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const res = await fetch(`${BASE}/chats/${params.id}/messages?limit=50`, {
    headers: headers(),
  });
  const data = await res.json();
  return NextResponse.json({ messages: data.items ?? data.messages ?? [] });
}
