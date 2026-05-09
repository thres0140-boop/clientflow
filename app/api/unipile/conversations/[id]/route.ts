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
    if (!res.ok) {
      console.error("[msgs] Unipile error:", JSON.stringify(data).slice(0, 200));
      return NextResponse.json({ error: data, messages: [] });
    }
    const msgs = data.items ?? data.messages ?? [];
    console.log(`[msgs] chat=${params.id.slice(0,8)} count=${msgs.length} keys=${Object.keys(data).join(',')}`);
    return NextResponse.json({ messages: msgs });
  } catch (err: any) {
    return NextResponse.json({ error: String(err), messages: [] });
  }
}
