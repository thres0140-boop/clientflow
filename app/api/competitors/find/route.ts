import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchSimilarAccounts, type FoundUser } from "@/lib/findCompetitors";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/competitors/find
//   { mode: "start", clientId, seed, keyword, goal }  → expand keywords, return crawl seed state
//   { mode: "step",  clientId, queue, seen, keywords, goal } → process ONE source handle (its
//       "following"), save niche-matching profiles as candidates, enqueue them for deeper crawl.
// The client loops "step" until done. State (queue/seen) round-trips through the client so the
// server stays stateless and each call is fast (a few API requests max).
export async function POST(req: NextRequest) {
  const body = await req.json();
  const clientId = parseInt(String(body.clientId));
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });

  if (body.mode === "start") {
    const seed = String(body.seed || "").replace(/^@/, "").trim();
    if (!seed) return NextResponse.json({ error: "seed handle required" }, { status: 400 });
    return NextResponse.json({ ok: true, queue: [seed], seen: [] });
  }

  // mode === "step"
  const queue: string[] = Array.isArray(body.queue) ? body.queue : [];
  const seen: string[] = Array.isArray(body.seen) ? body.seen : [];
  const goal = Math.min(500, Math.max(1, parseInt(String(body.goal)) || 100));
  const seenSet = new Set(seen);

  // Next un-crawled source.
  let source: string | undefined;
  while (queue.length) {
    const h = queue.shift()!;
    if (!seenSet.has(h)) { source = h; break; }
  }
  if (!source) {
    const found = await prisma.competitorCandidate.count({ where: { clientId } });
    return NextResponse.json({ ok: true, done: true, queue: [], seen, found, candidatesAdded: 0, requestsUsed: 0 });
  }
  seenSet.add(source);

  // Existing competitors + candidates → don't resurface.
  const [comps, cands] = await Promise.all([
    prisma.competitor.findMany({ where: { clientId }, select: { handle: true } }),
    prisma.competitorCandidate.findMany({ where: { clientId }, select: { handle: true } }),
  ]);
  const known = new Set<string>([...comps.map((c) => c.handle.toLowerCase().replace(/^@/, "")), ...cands.map((c) => c.handle.toLowerCase())]);

  let requestsUsed = 0;
  let candidatesAdded = 0;
  // One request returns ~40 algorithmically-similar (niche peer) accounts.
  const matches: { user: FoundUser; kw: string }[] = [];
  const r = await fetchSimilarAccounts(source);
  requestsUsed++;
  if (r.ok) {
    for (const u of r.users) {
      const uname = u.username.toLowerCase();
      if (u.isPrivate) continue;                  // can't scrape private reels later
      // Every similar account is a niche peer → enqueue it to crawl deeper.
      if (!seenSet.has(uname) && !queue.includes(uname) && queue.length < 400) queue.push(u.username);
      if (!known.has(uname)) { known.add(uname); matches.push({ user: u, kw: `similar to @${source}` }); }
    }
  }

  // Crawl is fast & never enriches inline — gender/language are inferred lazily afterward
  // (see /api/competitors/candidates/enrich). This keeps the step well under the timeout.
  for (const m of matches) {
    try {
      await prisma.competitorCandidate.create({
        data: {
          clientId, handle: m.user.username, name: m.user.fullName || null,
          profilePicUrl: m.user.profilePicUrl || null, matched: m.kw, status: "pending",
        },
      });
      candidatesAdded++;
    } catch { /* unique race — ignore */ }
  }

  const found = await prisma.competitorCandidate.count({ where: { clientId } });
  const done = found >= goal || queue.length === 0;
  return NextResponse.json({
    ok: true, done, queue, seen: Array.from(seenSet), found, candidatesAdded, requestsUsed, source,
  });
}
