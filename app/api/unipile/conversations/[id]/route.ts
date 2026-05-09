import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const dsn = (process.env.UNIPILE_DSN ?? "").trim();
    const key = (process.env.UNIPILE_API_KEY ?? "").trim();

    if (!dsn || !key) {
      return NextResponse.json({ error: `env missing: dsn=${dsn ? "ok" : "missing"} key=${key ? "ok" : "missing"}`, messages: [] });
    }

    const url = `https://${dsn}/api/v1/chats/${params.id}/messages?limit=50`;
    console.log(`[msgs] fetching: ${url.slice(0, 80)}`);

    const res = await fetch(url, {
      headers: { "X-API-KEY": key, "accept": "application/json" },
      cache: "no-store",
    });
    const data = await res.json();

    if (!res.ok) {
      console.error(`[msgs] error ${res.status}:`, JSON.stringify(data).slice(0, 200));
      return NextResponse.json({ error: data, messages: [] });
    }

    const msgs = data.items ?? data.messages ?? [];
    console.log(`[msgs] ok count=${msgs.length}`);
    return NextResponse.json({ messages: msgs });
  } catch (err: any) {
    console.error("[msgs] catch:", String(err));
    return NextResponse.json({ error: String(err), messages: [] });
  }
}
