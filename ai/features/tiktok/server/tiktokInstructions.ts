import { prisma } from "@/ai/db/prisma";
import { fetchTikTokZernio } from "@/ai/features/tiktok/server/tiktokZernio";

// ─────────────────────────────────────────────────────────────────────────────
// TikTok Instructions engine — per-client, TikTok-ONLY. Never reads/writes any
// Instagram data. Objective: MAXIMIZE EXPECTED VIEWS. Every recommendation is
// denominated in Expected Views per Post (EV) and routed into four buckets:
//   keep  → highest-EV proven concepts (exploit)
//   test  → high-upside, under-explored concepts (explore, UCB-ranked)
//   copy  → competitor breakouts (previews of new high-EV arms)
//   stop  → low-EV / fatiguing concepts (opportunity cost)
// Statistical guardrails: Bayesian shrinkage (small samples), recency decay,
// competitor bought-view filtering, corroboration, saturation via recency.
// ─────────────────────────────────────────────────────────────────────────────

export type Rec = {
  id: string;
  title: string;
  ev: number;              // expected views per post
  evidence: string;        // number-grounded reason
  action: string;          // concrete next step
  score: number;           // ranking score within the bucket
  meta?: Record<string, unknown>;
};
export type Instructions = {
  connected: boolean;
  summary: string;
  stats: { totalVideos: number; accountMedianViews: number; conceptsTracked: number; competitorsScanned: number; breakoutsFound: number };
  keep: Rec[];
  test: Rec[];
  copy: Rec[];
  stop: Rec[];
  generatedAt: string;
  note?: string;
};

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs: number[]): number { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); }
function daysAgo(iso?: string | Date | null): number {
  if (!iso) return 9999;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? (Date.now() - t) / 86400_000 : 9999;
}
const STOP = new Set(["the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "is", "it", "you", "your", "de", "la", "el", "que", "y", "en", "un", "una", "los", "las", "con", "por", "para", "mi", "tu", "se", "no", "si", "lo", "al", "del"]);
function tokens(...parts: (string | null | undefined)[]): Set<string> {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  const words = text.replace(/[^a-z0-9áéíóúñ#\s]/gi, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  return new Set(words);
}
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  return hit / Math.min(a.size, b.size); // asymmetric overlap (how much of the smaller set matches)
}
function fmtViews(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1_000) return Math.round(n / 1_000) + "K";
  return String(Math.round(n));
}

export async function generateInstructions(clientId: number): Promise<Instructions> {
  const empty: Instructions = {
    connected: false, summary: "", stats: { totalVideos: 0, accountMedianViews: 0, conceptsTracked: 0, competitorsScanned: 0, breakoutsFound: 0 },
    keep: [], test: [], copy: [], stop: [], generatedAt: new Date().toISOString(),
  };

  // 1. Own TikTok performance (Zernio) — TikTok only.
  const data = await fetchTikTokZernio(clientId, 90);
  if (!data.connected) return { ...empty, note: "Connect this client's TikTok to generate the playbook." };
  const videos = (data.videos || []).filter((v) => v.publishedAt);
  if (videos.length < 3) return { ...empty, connected: true, note: "Not enough posted videos yet — the playbook sharpens as more videos accumulate." };

  const ownViews = videos.map((v) => v.views);
  const accountMedian = median(ownViews);
  const accountMean = mean(ownViews);
  const accountStd = std(ownViews) || accountMean * 0.5 || 1;

  // 2. Concept tags (TikTok concepts only).
  const mapRows: any[] = await (prisma as any).tikTokVideoConcept.findMany({ where: { clientId }, select: { videoId: true, conceptId: true } }).catch(() => []); // eslint-disable-line @typescript-eslint/no-explicit-any
  const videoConcept = new Map<string, number>();
  for (const r of mapRows) videoConcept.set(r.videoId, r.conceptId);
  const conceptIds = [...new Set(mapRows.map((r) => r.conceptId))];
  const conceptRows: any[] = conceptIds.length // eslint-disable-line @typescript-eslint/no-explicit-any
    ? await (prisma as any).concept.findMany({ where: { id: { in: conceptIds }, platform: "tiktok" }, select: { id: true, name: true, guidelines: true, angle: true, hookType: true } }).catch(() => [])
    : [];
  const conceptById = new Map<number, any>(conceptRows.map((c) => [c.id, c])); // eslint-disable-line @typescript-eslint/no-explicit-any

  // 3. Per-concept EV rollup.
  const K = 3; // shrinkage prior strength
  type CStat = { id: number; name: string; n: number; ev: number; momentum: number; hitRate: number; trend: number; lastDays: number; ucb: number; tokens: Set<string> };
  const cstats: CStat[] = [];
  const byConcept = new Map<number, typeof videos>();
  for (const v of videos) {
    const cid = videoConcept.get(v.id);
    if (cid == null) continue;
    if (!byConcept.has(cid)) byConcept.set(cid, []);
    byConcept.get(cid)!.push(v);
  }
  for (const [cid, vs] of byConcept) {
    const c = conceptById.get(cid);
    if (!c) continue;
    const vw = vs.map((v) => v.views);
    const n = vs.length;
    const rawSum = vw.reduce((a, b) => a + b, 0);
    const shrunkEV = (rawSum + K * accountMedian) / (n + K); // Bayesian shrinkage → account median
    // recency-weighted momentum (21-day soft half-life)
    let wSum = 0, wvSum = 0;
    for (const v of vs) { const w = Math.exp(-daysAgo(v.publishedAt) / 21); wSum += w; wvSum += w * v.views; }
    const momentum = wSum ? wvSum / wSum : shrunkEV;
    const hitRate = vw.filter((x) => x > accountMedian).length / n;
    const recent = vs.filter((v) => daysAgo(v.publishedAt) <= 30).map((v) => v.views);
    const older = vs.filter((v) => daysAgo(v.publishedAt) > 30).map((v) => v.views);
    const trend = recent.length && older.length && mean(older) > 0 ? (mean(recent) - mean(older)) / mean(older) : 0;
    const lastDays = Math.min(...vs.map((v) => daysAgo(v.publishedAt)));
    const ucb = shrunkEV + 1.2 * accountStd / Math.sqrt(n); // exploration bonus shrinks with samples
    const conceptCaptions = vs.map((v) => v.content).join(" ");
    cstats.push({ id: cid, name: c.name, n, ev: shrunkEV, momentum, hitRate, trend, lastDays, ucb, tokens: tokens(c.name, c.guidelines, c.angle, c.hookType, conceptCaptions) });
  }

  // 4. Competitor reels (TikTok only) → medians + breakouts.
  const reels: any[] = await (prisma as any).competitorReel.findMany({ // eslint-disable-line @typescript-eslint/no-explicit-any
    where: { platform: "tiktok", competitor: { clientId } },
    select: { competitorId: true, caption: true, transcript: true, format: true, permalink: true, postedAt: true, firstSeenAt: true,
      competitor: { select: { handle: true } },
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1, select: { viewCount: true, likeCount: true, commentCount: true } } },
    orderBy: { postedAt: "desc" }, take: 2500,
  }).catch(() => []);

  const compViews = new Map<number, number[]>();
  for (const r of reels) {
    const v = r.snapshots?.[0]?.viewCount;
    if (v == null) continue;
    if (!compViews.has(r.competitorId)) compViews.set(r.competitorId, []);
    compViews.get(r.competitorId)!.push(v);
  }
  const compMedian = new Map<number, number>();
  for (const [cid, vs] of compViews) compMedian.set(cid, median(vs));

  type Breakout = { handle: string; views: number; likes: number; comments: number; outlier: number; days: number; caption: string; transcript: string; format: string | null; permalink: string | null; score: number; tokens: Set<string> };
  const breakouts: Breakout[] = [];
  for (const r of reels) {
    const snap = r.snapshots?.[0];
    const views = snap?.viewCount;
    if (views == null || views < 15000) continue;      // absolute floor
    const days = daysAgo(r.postedAt || r.firstSeenAt);
    if (days > 21) continue;                             // recency window (avoid stale/saturated)
    const cmed = compMedian.get(r.competitorId) || 0;
    const outlier = views / Math.max(1, cmed);
    if (outlier < 2.5) continue;                         // must beat the competitor's own baseline
    const likes = snap?.likeCount ?? 0;
    const likeRatio = likes / views;
    if (likeRatio < 0.003 || likeRatio > 0.6) continue;  // bought-view / anomaly filter
    const recency = Math.exp(-days / 12);
    const score = Math.log10(views) * outlier * recency;
    breakouts.push({ handle: r.competitor?.handle || "competitor", views, likes, comments: snap?.commentCount ?? 0, outlier, days,
      caption: r.caption || "", transcript: (r.transcript || "").slice(0, 400), format: r.format, permalink: r.permalink,
      score, tokens: tokens(r.caption, r.transcript) });
  }
  breakouts.sort((a, b) => b.score - a.score);

  // 5. Route into buckets.
  // KEEP — proven, exploit. Boost EV where competitors corroborate the theme.
  const keep: Rec[] = cstats
    .filter((c) => c.ev >= accountMedian && c.n >= 2 && c.trend > -0.35)
    .map((c) => {
      const corroboration = breakouts.filter((b) => overlap(c.tokens, b.tokens) >= 0.18).length;
      const trendTxt = c.trend > 0.15 ? "trending up" : c.trend < -0.15 ? "cooling" : "steady";
      return {
        id: `keep-${c.id}`, title: c.name, ev: Math.round(c.momentum), score: c.momentum * (1 + 0.1 * corroboration),
        evidence: `${fmtViews(Math.round(c.momentum))} avg views · ${Math.round(c.hitRate * 100)}% beat your median · ${c.n} posts · ${trendTxt}${corroboration ? ` · ${corroboration} competitor${corroboration > 1 ? "s" : ""} winning on it too` : ""}`,
        action: `Keep this in rotation${c.lastDays > 10 ? ` — you haven't posted it in ${Math.round(c.lastDays)} days` : ""}. It's above your baseline and reliable.`,
        meta: { conceptId: c.id, corroboration },
      };
    })
    .sort((a, b) => b.score - a.score).slice(0, 6);

  // TEST — high upside, under-explored (UCB), or competitor-validated but under-posted.
  const keepIds = new Set(keep.map((k) => k.meta?.conceptId));
  const test: Rec[] = cstats
    .filter((c) => !keepIds.has(c.id))
    .map((c) => {
      const validators = breakouts.filter((b) => overlap(c.tokens, b.tokens) >= 0.18);
      const boost = validators.length ? 1.4 : 1;
      return { c, validators, testScore: c.ucb * boost };
    })
    .filter((x) => x.validators.length > 0 || (x.c.n <= 2 && x.c.ucb >= accountMedian * 0.8))
    .sort((a, b) => b.testScore - a.testScore)
    .slice(0, 5)
    .map(({ c, validators, testScore }) => ({
      id: `test-${c.id}`, title: c.name, ev: Math.round(c.ev), score: testScore,
      evidence: validators.length
        ? `${validators.length} competitor breakout${validators.length > 1 ? "s" : ""} on this theme (up to ${fmtViews(validators[0].views)} views) · you've only posted it ${c.n}×${c.lastDays < 900 ? `, last ${Math.round(c.lastDays)}d ago` : ""}`
        : `High upside, low sample (${c.n} post${c.n > 1 ? "s" : ""}) — worth more shots to learn its true ceiling`,
      action: validators.length
        ? `Post 1–2 this week. The niche is proving demand and you're under-posting it.`
        : `Give it 2–3 more posts to nail down whether it's a winner.`,
      meta: { conceptId: c.id, validators: validators.length },
    }));

  // COPY — competitor breakouts NOT already covered by a strong concept (new arms to add).
  const copy: Rec[] = breakouts
    .filter((b) => {
      const best = Math.max(0, ...cstats.map((c) => overlap(c.tokens, b.tokens)));
      return best < 0.28; // genuinely new angle for this account
    })
    .slice(0, 6)
    .map((b, i) => ({
      id: `copy-${i}`, title: `@${b.handle}`, ev: Math.round(b.views * 0.35), score: b.score,
      evidence: `${fmtViews(b.views)} views · ${b.outlier.toFixed(1)}× @${b.handle}'s median · ${Math.round(b.days)}d ago${b.format ? ` · ${b.format.replace("_", " ")}` : ""}`,
      action: `Adapt for this account: "${(b.caption || b.transcript || "").slice(0, 90).trim() || "(open the video)"}". New angle you're not running yet.`,
      meta: { permalink: b.permalink, handle: b.handle, caption: b.caption, format: b.format },
    }));

  // STOP — fatiguing / below-baseline concepts (opportunity cost).
  const stop: Rec[] = cstats
    .filter((c) => c.n >= 3 && (c.ev < accountMedian * 0.65 || c.trend < -0.35))
    .map((c) => ({
      id: `stop-${c.id}`, title: c.name, ev: Math.round(c.ev), score: accountMedian - c.ev,
      evidence: `${fmtViews(Math.round(c.ev))} avg (${Math.round((c.ev / (accountMedian || 1)) * 100)}% of your median) · ${Math.round(c.hitRate * 100)}% hit rate${c.trend < -0.2 ? " · declining" : ""} · ${c.n} posts`,
      action: c.trend < -0.35 ? `Rework the hook/format — it's fading. Each slot here is views you're not getting elsewhere.` : `Pause or rework — it consistently underperforms your baseline.`,
      meta: { conceptId: c.id },
    }))
    .sort((a, b) => b.score - a.score).slice(0, 5);

  const summary = buildSummary({ keep, test, copy, stop, accountMedian, breakouts: breakouts.length });

  return {
    connected: true, summary,
    stats: { totalVideos: videos.length, accountMedianViews: Math.round(accountMedian), conceptsTracked: cstats.length, competitorsScanned: compMedian.size, breakoutsFound: breakouts.length },
    keep, test, copy, stop, generatedAt: new Date().toISOString(),
  };
}

function buildSummary(x: { keep: Rec[]; test: Rec[]; copy: Rec[]; stop: Rec[]; accountMedian: number; breakouts: number }): string {
  const parts: string[] = [];
  if (x.keep[0]) parts.push(`Lean into **${x.keep[0].title}** (${fmtViews(x.keep[0].ev)} avg) — your highest-EV concept right now.`);
  if (x.copy[0]) parts.push(`${x.breakouts} competitor breakout${x.breakouts === 1 ? "" : "s"} detected; the top new angle is from **${x.copy[0].title}**.`);
  if (x.test[0]) parts.push(`Test **${x.test[0].title}** — high upside you're under-exploring.`);
  if (x.stop[0]) parts.push(`Cut/rework **${x.stop[0].title}** to free up slots.`);
  return parts.join(" ") || "Tag more videos with concepts and add TikTok competitors to sharpen the playbook.";
}
