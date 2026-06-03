import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { scrapeCompetitorProfile } from "@/lib/scrapeCompetitors";

export const maxDuration = 120;

const FRESH_MS = 12 * 3600_000; // profile considered fresh for 12h

// POST { clientId }       → sync only competitors that are MISSING data or stale
//                           (>12h old). Won't re-hit the API for ones just synced.
// POST { clientId, force } → re-sync every competitor of that client.
// POST { id }             → sync a single competitor (always).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  let ids: number[] = [];

  if (body.id) {
    ids = [parseInt(body.id)];
  } else if (body.clientId) {
    const comps = await prisma.competitor.findMany({
      where: { clientId: parseInt(body.clientId) },
      select: { id: true, lastProfileSyncAt: true } as any,
    });
    const cutoff = Date.now() - FRESH_MS;
    const picked = body.force
      ? comps
      : comps.filter((c: any) => !c.lastProfileSyncAt || new Date(c.lastProfileSyncAt).getTime() < cutoff);
    ids = picked.map((c: any) => c.id);
    if (!ids.length) {
      // everything already fresh — nothing to do, don't spend API quota
      return NextResponse.json({ ok: true, synced: 0, total: comps.length, upToDate: true });
    }
  }

  if (!ids.length) return NextResponse.json({ error: "no competitors" }, { status: 400 });

  let synced = 0;
  let lastError: string | undefined;
  for (const id of ids) {
    const r = await scrapeCompetitorProfile(id);
    if (r.ok) synced++;
    else lastError = r.error;
  }
  return NextResponse.json({ ok: true, synced, total: ids.length, error: synced === 0 ? lastError : undefined });
}
