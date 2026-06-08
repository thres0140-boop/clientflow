import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { classifyProfiles } from "@/lib/findCompetitors";
import { fetchProfileInfo } from "@/lib/scrapeCompetitors";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/competitors/candidates/enrich  { clientId, limit? }
// Infers gender + language for a small batch of not-yet-enriched candidates (bio fetch +
// one batched Claude call). Called repeatedly by the client as a background drip — keeps
// each request fast and never blocks the crawl. Returns { enriched, remaining }.
export async function POST(req: NextRequest) {
  const { clientId, limit } = await req.json();
  const cid = parseInt(String(clientId));
  if (!cid) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  const take = Math.min(8, Math.max(1, parseInt(String(limit)) || 6));

  const batch = await prisma.competitorCandidate.findMany({
    where: { clientId: cid, status: "pending", gender: null },
    orderBy: { createdAt: "desc" },
    take,
  });
  if (!batch.length) {
    return NextResponse.json({ ok: true, enriched: 0, remaining: 0 });
  }

  // Fetch bios (the similar-accounts list omits them), then classify the batch in one call.
  const withBios = await Promise.all(batch.map(async (c) => {
    let bio = "";
    try { bio = (await fetchProfileInfo(c.handle)).bio || ""; } catch { /* ignore */ }
    return { handle: c.handle, name: c.name || "", bio };
  }));
  const cls = await classifyProfiles(withBios);

  let enriched = 0;
  for (const c of batch) {
    const v = cls[c.handle.toLowerCase()];
    await prisma.competitorCandidate.update({
      where: { id: c.id },
      data: { gender: v?.gender || "unknown", language: v?.language || "unknown" }, // mark done so we don't re-fetch
    }).catch(() => {});
    enriched++;
  }

  const remaining = await prisma.competitorCandidate.count({ where: { clientId: cid, status: "pending", gender: null } });
  return NextResponse.json({ ok: true, enriched, remaining });
}
