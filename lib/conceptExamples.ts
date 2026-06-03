import { prisma } from "@/lib/prisma";

// first-line, normalized — used to dedup examples by their hook
export function hookKeyOf(text: string): string {
  const first = (text || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  return first.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
}

const FORMAT_LABEL: Record<string, string> = {
  talking_head: "talking-head (person speaking to camera)",
  text_overlay: "B-roll + on-screen text (no voiceover)",
  broll: "B-roll / footage",
};

// Add an example to the provenance pool (deduped by hook within the concept).
export async function addConceptExample(
  conceptId: number,
  text: string,
  source: "human_seed" | "accepted_draft" | "proven_winner",
  opts: { scriptDraftId?: number; reelShortcode?: string; views?: number; format?: string | null } = {}
) {
  const clean = (text || "").trim();
  if (clean.length < 8) return;
  const hookKey = hookKeyOf(clean);
  const dup = await (prisma as any).conceptExample.findFirst({ where: { conceptId, hookKey } });
  if (dup) {
    // backfill format if we now know it
    if (opts.format && !dup.format) {
      await (prisma as any).conceptExample.update({ where: { id: dup.id }, data: { format: opts.format } }).catch(() => {});
    }
    return;
  }
  await (prisma as any).conceptExample.create({
    data: {
      conceptId, source, text: clean, hookKey,
      scriptDraftId: opts.scriptDraftId ?? null,
      reelShortcode: opts.reelShortcode ?? null,
      format: opts.format ?? null,
      views: opts.views ?? null,
    },
  });
}

// Promote accepted drafts to proven_winner once their posted reel beat the
// creator's own median daily views. Driven by AnalyticsEntry (persisted views).
export async function promoteProvenExamples(): Promise<{ promoted: number }> {
  const pending = await (prisma as any).conceptExample.findMany({
    where: { source: "accepted_draft", scriptDraftId: { not: null } },
  });
  if (!pending.length) return { promoted: 0 };

  const drafts = await prisma.scriptDraft.findMany({
    where: { id: { in: pending.map((p: any) => p.scriptDraftId) } },
    select: { id: true, clientId: true, scheduledDate: true },
  });
  const draftMap = new Map(drafts.map((d) => [d.id, d]));

  const medianCache = new Map<number, number>();
  async function medianFor(clientId: number): Promise<number> {
    if (medianCache.has(clientId)) return medianCache.get(clientId)!;
    const es = await prisma.analyticsEntry.findMany({ where: { clientId, views: { gt: 0 } }, select: { views: true } });
    const arr = es.map((e) => e.views).sort((a, b) => a - b);
    const m = arr.length ? arr[Math.floor(arr.length / 2)] : 0;
    medianCache.set(clientId, m);
    return m;
  }

  let promoted = 0;
  for (const ex of pending) {
    const d = draftMap.get(ex.scriptDraftId);
    if (!d || !d.scheduledDate) continue; // not posted yet
    const date = String(d.scheduledDate).slice(0, 10);
    const entry = await prisma.analyticsEntry.findUnique({ where: { clientId_date: { clientId: d.clientId, date } } }).catch(() => null);
    const views = entry?.views ?? 0;
    if (views <= 0) continue;
    const med = await medianFor(d.clientId);
    if (med > 0 && views >= med) {
      await (prisma as any).conceptExample.update({ where: { id: ex.id }, data: { source: "proven_winner", views } }).catch(() => {});
      promoted++;
    }
  }
  return { promoted };
}

// Build the labeled, capped, deduped EXAMPLE block for the generator's system prompt.
// Trusted set = concept.scriptExamples (human-curated + reel-pulled) + any proven_winner rows.
// Then a few newest accepted-but-unproven drafts, clearly labeled as lower-trust.
export async function buildExamplesBlock(concept: { id: number; scriptExamples?: string | null }): Promise<string> {
  const PROVEN_CAP = 6;
  const DRAFT_CAP = 3;

  const seen = new Set<string>();
  const proven: string[] = [];

  // 1) trusted, human-curated / reel-pulled examples (the canonical "what wins")
  for (const ex of (concept.scriptExamples || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)) {
    const k = hookKeyOf(ex);
    if (seen.has(k)) continue;
    seen.add(k);
    proven.push(ex);
    if (proven.length >= PROVEN_CAP) break;
  }

  // 2) performance-promoted winners from the pool
  let rows: any[] = [];
  try {
    rows = await (prisma as any).conceptExample.findMany({
      where: { conceptId: concept.id },
      orderBy: { createdAt: "desc" },
    });
  } catch { rows = []; }

  for (const r of rows.filter((r) => r.source === "proven_winner")) {
    if (proven.length >= PROVEN_CAP) break;
    const k = r.hookKey || hookKeyOf(r.text);
    if (seen.has(k)) continue;
    seen.add(k);
    proven.push(r.text);
  }

  // 3) newest accepted-but-unproven drafts (recent context, lower trust)
  const drafts: string[] = [];
  for (const r of rows.filter((r) => r.source === "accepted_draft")) {
    if (drafts.length >= DRAFT_CAP) break;
    const k = r.hookKey || hookKeyOf(r.text);
    if (seen.has(k)) continue;
    seen.add(k);
    drafts.push(r.text);
  }

  // Dominant winning format across reel-derived examples (soft signal, not a rule).
  let formatHint = "";
  const fmtCounts: Record<string, number> = {};
  for (const r of rows) { if (r.format) fmtCounts[r.format] = (fmtCounts[r.format] || 0) + 1; }
  const fmtTotal = Object.values(fmtCounts).reduce((a, b) => a + b, 0);
  if (fmtTotal >= 2) {
    const [topFmt, topN] = Object.entries(fmtCounts).sort((a, b) => b[1] - a[1])[0];
    if (topN / fmtTotal >= 0.6 && FORMAT_LABEL[topFmt]) {
      formatHint = `\n\nFORMAT SIGNAL: most of this concept's proven reels are ${FORMAT_LABEL[topFmt]}. Lean toward that format unless asked otherwise — it's a hint, not a hard rule.`;
    }
  }

  if (!proven.length && !drafts.length) return formatHint;

  let block = "";
  if (proven.length) {
    block += `\n\nPROVEN REFERENCE EXAMPLES — real posted/curated content for this concept. This is the voice & style to match:\n` +
      proven.map((ex, i) => `Example ${i + 1}:\n${ex}`).join("\n\n");
  }
  if (drafts.length) {
    block += `\n\nRECENT ACCEPTED DRAFTS — approved but NOT yet proven by performance. Treat as recent context only; do NOT copy them as if they're winners, and don't repeat their wording:\n` +
      drafts.map((ex, i) => `Draft ${i + 1}:\n${ex}`).join("\n\n");
  }
  return block + formatHint;
}
