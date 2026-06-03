import { prisma } from "@/lib/prisma";

// first-line, normalized — used to dedup examples by their hook
export function hookKeyOf(text: string): string {
  const first = (text || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
  return first.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
}

// Add an example to the provenance pool (deduped by hook within the concept).
export async function addConceptExample(
  conceptId: number,
  text: string,
  source: "human_seed" | "accepted_draft" | "proven_winner",
  opts: { scriptDraftId?: number; reelShortcode?: string; views?: number } = {}
) {
  const clean = (text || "").trim();
  if (clean.length < 8) return;
  const hookKey = hookKeyOf(clean);
  const dup = await (prisma as any).conceptExample.findFirst({ where: { conceptId, hookKey } });
  if (dup) return;
  await (prisma as any).conceptExample.create({
    data: { conceptId, source, text: clean, hookKey, scriptDraftId: opts.scriptDraftId ?? null, reelShortcode: opts.reelShortcode ?? null, views: opts.views ?? null },
  });
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

  if (!proven.length && !drafts.length) return "";

  let block = "";
  if (proven.length) {
    block += `\n\nPROVEN REFERENCE EXAMPLES — real posted/curated content for this concept. This is the voice & style to match:\n` +
      proven.map((ex, i) => `Example ${i + 1}:\n${ex}`).join("\n\n");
  }
  if (drafts.length) {
    block += `\n\nRECENT ACCEPTED DRAFTS — approved but NOT yet proven by performance. Treat as recent context only; do NOT copy them as if they're winners, and don't repeat their wording:\n` +
      drafts.map((ex, i) => `Draft ${i + 1}:\n${ex}`).join("\n\n");
  }
  return block;
}
