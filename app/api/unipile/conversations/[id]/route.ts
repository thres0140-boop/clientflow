import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const dsn = (process.env.UNIPILE_DSN ?? "").trim();
    const key = (process.env.UNIPILE_API_KEY ?? "").trim();

    if (!dsn || !key) {
      return NextResponse.json({ error: `env missing: dsn=${dsn ? "ok" : "missing"}`, messages: [] });
    }

    const res = await fetch(`https://${dsn}/api/v1/chats/${params.id}/messages?limit=50`, {
      headers: { "X-API-KEY": key, "accept": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data, messages: [] });
    return NextResponse.json({ messages: data.items ?? data.messages ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: String(err), messages: [] });
  }
}
