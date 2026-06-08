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
  const take = Math.min(12, Math.max(1, parseInt(String(limit)) || 10));

  const batch = await prisma.competitorCandidate.findMany({
    where: { clientId: cid, status: "pending", gender: null }, // gender=null ⇒ not yet enriched
    orderBy: { createdAt: "desc" },
    take,
  });
  if (!batch.length) {
    return NextResponse.json({ ok: true, enriched: 0, remaining: 0 });
  }

  // Pull each profile (bio, followers, pic), then classify the whole batch in one call.
  const profiles = await Promise.all(batch.map(async (c) => {
    try {
      const p = await fetchProfileInfo(c.handle);
      return { id: c.id, handle: c.handle, name: c.name || "", bio: p.bio || "", followerCount: p.followerCount ?? null, pic: p.profilePicUrl || null };
    } catch {
      return { id: c.id, handle: c.handle, name: c.name || "", bio: "", followerCount: null, pic: null };
    }
  }));
  const cls = await classifyProfiles(profiles.map((p) => ({ handle: p.handle, name: p.name, bio: p.bio })));

  let enriched = 0;
  for (const p of profiles) {
    const v = cls[p.handle.toLowerCase()];
    await prisma.competitorCandidate.update({
      where: { id: p.id },
      data: {
        bio: p.bio || null,
        followerCount: p.followerCount,
        profilePicUrl: p.pic || undefined, // refresh with a current pic url
        gender: v?.gender || "unknown",     // non-null ⇒ marked enriched
        language: v?.language || "unknown",
      },
    }).catch(() => {});
    enriched++;
  }

  const remaining = await prisma.competitorCandidate.count({ where: { clientId: cid, status: "pending", gender: null } });
  return NextResponse.json({ ok: true, enriched, remaining });
}
