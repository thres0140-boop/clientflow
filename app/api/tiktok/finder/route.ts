import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import Anthropic from "@anthropic-ai/sdk";
import { fetchTikTokProfile } from "@/features/tiktok/server/scrapeTikTok";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// TikTok's followings/search endpoints are login-gated (return empty via the public API), so discovery
// works by having the model propose real niche handles from the seeds, then VALIDATING each against
// the working profile-info endpoint — only accounts that actually exist (with real stats) are kept.
async function suggestFromSeeds(seeds: { handle: string; name?: string; bio?: string }[], exemplars: string[]): Promise<{ keywords: string[]; handles: string[] }> {
  const lines = seeds.map((s) => `@${s.handle}${s.name ? ` (${s.name})` : ""}${s.bio ? ` — ${s.bio}` : ""}`).join("\n");
  try {
    const client = new Anthropic();
    const r = await client.messages.create({
      model: "claude-sonnet-5", max_tokens: 900,
      messages: [{ role: "user", content: `I track competitor TikTok creators in ONE specific niche. Here are the seed accounts I want more like:\n${lines}\n\nOther accounts already in this exact niche (use these to understand the niche + typical audience size — do NOT repeat any of them): ${exemplars.slice(0, 60).join(", ") || "none"}\n\nFind more real TikTok creators in this SAME niche and SAME language, with a SIMILAR audience size to the accounts above (small-to-mid creators, not mega-famous). Hard rules:\n- Same content niche and language only.\n- NO mega-celebrities, NO generic/brand/official accounts (e.g. no tiktok_es, no music artists, no general influencers).\n- Only handles you are genuinely confident exist.\n\nReturn ONLY JSON: {"keywords": [4 short niche keywords in the accounts' language], "handles": [up to 30 real TikTok @handles without the @]}. No explanation.` }],
    });
    const text = r.content[0].type === "text" ? r.content[0].text : "{}";
    const m = text.match(/\{[\s\S]*\}/);
    const obj = m ? JSON.parse(m[0]) : {};
    return {
      keywords: Array.isArray(obj.keywords) ? obj.keywords.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 6) : [], // eslint-disable-line @typescript-eslint/no-explicit-any
      handles: Array.isArray(obj.handles) ? obj.handles.map((x: any) => String(x).replace(/^@/, "").trim()).filter(Boolean).slice(0, 30) : [], // eslint-disable-line @typescript-eslint/no-explicit-any
    };
  } catch { return { keywords: [], handles: [] }; }
}

// A follower ceiling to auto-reject accounts far outside the niche's size (mega-celebs the AI slips in).
function followerCeiling(tracked: { followerCount: number | null }[]): number {
  const counts = tracked.map((c) => c.followerCount ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
  if (!counts.length) return 3_000_000;
  const median = counts[Math.floor(counts.length / 2)];
  return Math.max(1_000_000, median * 40); // generous, but drops the 30M-follower celebrities
}

// Auto-discovery is DISABLED: the TikTok data provider (apibox tiktok-api23) login-gates every
// discovery endpoint — user search, followings, and hashtag feeds all return empty — and asking an
// LLM to recall niche handles produces fabricated accounts. So there is no reliable source to
// discover real competitors from. The seed/candidate infrastructure below is kept so this can be
// switched on instantly if a discovery-capable provider is added. Until then we return honestly.
const DISCOVERY_ENABLED = false;

// POST /api/tiktok/finder { clientId, seedHandles } — AI-suggest niche handles from the seeds, validate
// each against the live profile endpoint, dedupe against tracked/seeds/reviewed, store as candidates.
export async function POST(req: NextRequest) {
  const { clientId, seedHandles } = await req.json();
  const cid = parseInt(String(clientId || ""));
  const seeds: string[] = Array.isArray(seedHandles) ? seedHandles.map((h) => String(h).replace(/^@/, "").trim()).filter(Boolean).slice(0, 6) : [];
  if (!cid || !seeds.length) return NextResponse.json({ error: "clientId + seedHandles required" }, { status: 400 });

  if (!DISCOVERY_ENABLED) {
    return NextResponse.json({ error: "discovery_unavailable", message: "Auto-discovery isn't available: TikTok's public API (this provider) login-gates account search, followings and hashtag feeds, so there's no reliable way to find real competitors automatically. Add them via + Add or Import for now." });
  }

  const started = Date.now();
  const BUDGET_MS = 260_000;
  try {
    // Seed profiles (name + bio) to give the model niche context.
    const seedProfiles: { handle: string; name?: string; bio?: string }[] = [];
    for (const h of seeds) {
      const p = await fetchTikTokProfile(h).catch((e) => { if (e instanceof Error && e.message === "rate_limited") throw e; return null; });
      seedProfiles.push(p ? { handle: p.handle, name: p.nickname, bio: p.bio } : { handle: h });
    }

    // Exclusions: seeds, tracked competitors, already-reviewed candidates.
    const [tracked, seenCands] = await Promise.all([
      (prisma as any).competitor.findMany({ where: { clientId: cid, platform: "tiktok" }, select: { handle: true, followerCount: true } }),
      (prisma as any).competitorCandidate.findMany({ where: { clientId: cid, platform: "tiktok" }, select: { handle: true } }),
    ]);
    const exclude = new Set<string>([
      ...seeds.map((h) => h.toLowerCase()),
      ...tracked.map((c: any) => c.handle.toLowerCase()), // eslint-disable-line @typescript-eslint/no-explicit-any
      ...seenCands.map((c: any) => c.handle.toLowerCase()), // eslint-disable-line @typescript-eslint/no-explicit-any
    ]);
    const ceiling = followerCeiling(tracked);

    const { keywords, handles } = await suggestFromSeeds(seedProfiles, tracked.map((c: any) => c.handle)); // eslint-disable-line @typescript-eslint/no-explicit-any

    // Validate each suggested handle against the live profile endpoint — keep only real accounts that
    // are within the niche's size range (drops mega-celebs the model occasionally suggests).
    let created = 0, checked = 0, skippedSize = 0;
    for (const h of handles) {
      if (Date.now() - started > BUDGET_MS) break;
      const lc = h.toLowerCase();
      if (exclude.has(lc)) continue;
      exclude.add(lc);
      checked++;
      let p = null;
      try { p = await fetchTikTokProfile(h); }
      catch (e) { if (e instanceof Error && e.message === "rate_limited") throw e; }
      if (!p) continue; // doesn't exist / no data → skip
      if ((p.followerCount ?? 0) > ceiling) { skippedSize++; continue; } // too big for the niche
      await (prisma as any).competitorCandidate.create({
        data: { clientId: cid, platform: "tiktok", handle: p.handle, name: p.nickname || null, bio: p.bio || null, followerCount: p.followerCount ?? null, profilePicUrl: p.avatarUrl || null, matched: "AI niche match", status: "pending" },
      }).catch(() => {});
      created++;
      await new Promise((r) => setTimeout(r, 150));
    }

    return NextResponse.json({ ok: true, found: created, checked, skippedSize, keywords });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "discovery_failed";
    return NextResponse.json({ error: msg }, { status: 200 });
  }
}

// GET /api/tiktok/finder?clientId= → pending TikTok candidates for review.
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ candidates: [] });
  const candidates = await (prisma as any).competitorCandidate.findMany({
    where: { clientId: parseInt(clientId), platform: "tiktok", status: "pending" },
    orderBy: [{ followerCount: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ candidates });
}

// PUT /api/tiktok/finder { id, action: "accept" | "reject" } → accept (promote to a tracked
// competitor) or reject (kept so we don't resurface it).
export async function PUT(req: NextRequest) {
  const { id, action } = await req.json();
  if (!id || !["accept", "reject"].includes(action)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const cand = await (prisma as any).competitorCandidate.findUnique({ where: { id: parseInt(String(id)) } });
  if (!cand) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (action === "accept") {
    // Promote to a Competitor (skip if already tracked). Stats fill in on the next Sync.
    const exists = await (prisma as any).competitor.findFirst({ where: { clientId: cand.clientId, platform: "tiktok", handle: cand.handle } });
    if (!exists) {
      await (prisma as any).competitor.create({
        data: {
          clientId: cand.clientId, platform: "tiktok", handle: cand.handle,
          name: cand.name || cand.handle, bio: cand.bio || null, followerCount: cand.followerCount ?? null, profilePicUrl: cand.profilePicUrl || null,
        },
      }).catch(() => {});
    }
  }
  await (prisma as any).competitorCandidate.update({ where: { id: cand.id }, data: { status: action === "accept" ? "accepted" : "rejected" } });
  return NextResponse.json({ ok: true });
}

// DELETE /api/tiktok/finder?clientId= → clear all pending candidates.
export async function DELETE(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  await (prisma as any).competitorCandidate.deleteMany({ where: { clientId: parseInt(clientId), platform: "tiktok", status: "pending" } });
  return NextResponse.json({ ok: true });
}
