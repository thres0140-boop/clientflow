import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const dsn = (process.env.UNIPILE_DSN ?? "").trim();
    const key = (process.env.UNIPILE_API_KEY ?? "").trim();

    if (!dsn || !key) {
      return NextResponse.json({ error: `env missing`, messages: [] });
    }

    // Look up which account owns this chat so we can pass account_id
    const clientId = req.nextUrl.searchParams.get("clientId");
    let accountId: string | undefined;
    if (clientId) {
      const conn = await prisma.instagramConnection.findUnique({
        where: { clientId: parseInt(clientId) },
      });
      accountId = conn?.unipileAccountId ?? undefined;
    }

    const qs = accountId ? `?limit=50&account_id=${accountId}` : "?limit=50";
    const url = `https://${dsn}/api/v1/chats/${params.id}/messages${qs}`;
    console.log(`[msgs] ${url.slice(0, 100)}`);

    const res = await fetch(url, {
      headers: { "X-API-KEY": key, "accept": "application/json" },
      cache: "no-store",
    });
    const data = await res.json();

    if (!res.ok) {
      console.error(`[msgs] ${res.status}:`, JSON.stringify(data).slice(0, 200));
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
