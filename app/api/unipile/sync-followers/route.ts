import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Called by Vercel cron every 5 minutes (or manually)
export async function GET(req: NextRequest) {
  const dsn = (process.env.UNIPILE_DSN ?? "").trim();
  const key = (process.env.UNIPILE_API_KEY ?? "").trim();

  if (!dsn || !key) return NextResponse.json({ error: "env missing" }, { status: 500 });

  const connections = await prisma.instagramConnection.findMany();
  const results: Record<string, number> = {};

  for (const conn of connections) {
    try {
      const url = `https://${dsn}/api/v1/users/attendees?account_id=${conn.unipileAccountId}&limit=100`;
      const res = await fetch(url, {
        headers: { "X-API-KEY": key, accept: "application/json" },
        cache: "no-store",
      });

      if (!res.ok) {
        console.error(`[sync-followers] ${conn.clientId} status=${res.status}`);
        continue;
      }

      const data = await res.json();
      const attendees = data.items ?? data.attendees ?? data.contacts ?? [];
      let added = 0;

      for (const a of attendees) {
        const name: string = a.display_name ?? a.name ?? a.username ?? "Instagram User";
        const handle: string | null = a.username ?? a.handle ?? null;

        // Only add if not already in pipeline
        if (handle) {
          const existing = await prisma.dmLead.findFirst({
            where: { clientId: conn.clientId, handle },
          });
          if (existing) continue;
        }

        await prisma.dmLead.create({
          data: {
            clientId: conn.clientId,
            name,
            handle: handle ?? null,
            status: "follows",
            date: new Date().toISOString().slice(0, 10),
          },
        });
        added++;
      }

      results[conn.clientId] = added;
      console.log(`[sync-followers] client=${conn.clientId} added=${added}`);
    } catch (err) {
      console.error(`[sync-followers] client=${conn.clientId}`, err);
    }
  }

  return NextResponse.json({ ok: true, results });
}
