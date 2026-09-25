import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/prisma";
import { parseDocument } from "@/features/editor/model/document";
import { timelineWords } from "@/features/editor/model/captions";
import { alignToScript, normalizeToken, tokenizeScript } from "@/features/editor/model/align";
import { sessionFrom } from "@/features/editor/server/access";

export const runtime = "nodejs";

// GET /api/edit-projects/diagnostics/alignment[?format=text] — owner-only. For every edit project
// that holds a Whisper transcript, shows how well the draft's script aligns to it, WHERE it
// failed (script tokens next to the Whisper tokens they faced), the most frequent unmatched
// tokens on each side, and what the ratio would be under alternative normalisations
// (compound-aware, digits as words). It changes nothing; it exists so the 60 % floor and the
// Dutch normalisation can be judged on real drafts rather than guessed.

const DUTCH_NUMBERS: Record<string, string> = { "0": "nul", "1": "een", "2": "twee", "3": "drie", "4": "vier", "5": "vijf", "6": "zes", "7": "zeven", "8": "acht", "9": "negen", "10": "tien", "11": "elf", "12": "twaalf", "20": "twintig", "30": "dertig", "50": "vijftig", "100": "honderd" };

function ratioWith(whisper: { text: string; startMs: number; endMs: number }[], script: string, norm: (t: string) => string): number {
  // Same LCS as alignToScript, over a different normalisation, to see what normalisation buys.
  const a = whisper.map((w) => norm(w.text)), b = tokenizeScript(script).map(norm);
  const n = a.length, m = b.length;
  if (!n || !m) return 0;
  const dp = new Uint16Array((n + 1) * (m + 1));
  const idx = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[idx(i, j)] = a[i] === b[j] ? dp[idx(i + 1, j + 1)] + 1 : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
  return dp[0] / n;
}
const normDigits = (t: string) => { const n = normalizeToken(t); return DUTCH_NUMBERS[n] ?? n; };
/** Compound-aware: joins pairs when the joined token appears on the other side is a second pass;
 *  here approximated by comparing with hyphens/spaces removed inside tokens (already done) plus
 *  stripping a trailing "'s"/"s" plural — the common Dutch mismatch after a compound split. */
const normLoose = (t: string) => normDigits(t).replace(/s$/, "");

export async function GET(req: NextRequest) {
  const session = await sessionFrom(req);
  if (!session || session.type !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });
  const projects = await prisma.editProject.findMany({ select: { id: true, draftId: true, document: true, draft: { select: { title: true, hook: true, script: true, client: { select: { name: true, language: true } } } } } });
  const rows = [];
  for (const p of projects) {
    const doc = parseDocument(p.document);
    if (!doc.transcript || doc.transcript.assets.every((a) => a.words.length === 0)) continue;
    const script = [p.draft.hook, p.draft.script].filter((s) => s && s.trim()).join("\n");
    const words = timelineWords(doc, doc.transcript.assets).map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs }));
    const r = alignToScript(words, script, 0);
    const scriptTokens = tokenizeScript(script);
    const a = words.map((w) => normalizeToken(w.text)), b = scriptTokens.map(normalizeToken);
    const setA = new Set(a), setB = new Set(b);
    const count = (arr: string[], other: Set<string>) => { const c = new Map<string, number>(); for (const t of arr) if (!other.has(t)) c.set(t, (c.get(t) ?? 0) + 1); return [...c.entries()].sort((x, y) => y[1] - x[1]).slice(0, 25).map(([t, n]) => `${t}×${n}`); };
    // Failure samples: windows around script tokens that never matched, with Whisper's words at the same relative position.
    const samples: string[] = [];
    const matchedB = new Set<number>();
    { // recompute the LCS pairs to know which script indexes matched
      const n = a.length, m = b.length; const dp = new Uint16Array((n + 1) * (m + 1)); const idx = (i: number, j: number) => i * (m + 1) + j;
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[idx(i, j)] = a[i] === b[j] ? dp[idx(i + 1, j + 1)] + 1 : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
      let i = 0, j = 0; const pairs: [number, number][] = [];
      while (i < n && j < m) { if (a[i] === b[j]) { pairs.push([i, j]); matchedB.add(j); i++; j++; } else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) i++; else j++; }
      let last: [number, number] = [-1, -1];
      for (const pr of [...pairs, [n, m] as [number, number]]) {
        const gapS = pr[1] - last[1] - 1, gapW = pr[0] - last[0] - 1;
        if (gapS > 0 && samples.length < 12) samples.push(`script[${last[1] + 1}..${pr[1] - 1}] "${scriptTokens.slice(last[1] + 1, pr[1]).join(" ")}"  ⇄  whisper[${last[0] + 1}..${pr[0] - 1}] "${words.slice(last[0] + 1, pr[0]).map((w) => w.text).join(" ")}"  (${gapS} script / ${gapW} whisper)`);
        last = pr;
      }
    }
    rows.push({
      projectId: p.id, draftId: p.draftId, title: p.draft.title, client: p.draft.client.name, language: p.draft.client.language,
      whisperWords: words.length, scriptTokens: scriptTokens.length,
      ratio: r ? +r.ratio.toFixed(3) : null, matched: r?.matched, substituted: r?.substituted, improvised: r?.improvised, skipped: r?.skipped,
      ratioWithDigitsAsWords: +ratioWith(words, script, normDigits).toFixed(3),
      ratioLoosePlurals: +ratioWith(words, script, normLoose).toFixed(3),
      lcsCoverageOfScript: +(matchedB.size / Math.max(1, scriptTokens.length)).toFixed(3),
      unmatchedWhisperTop: count(a, setB), unmatchedScriptTop: count(b, setA),
      failureSamples: samples,
      scriptHead: scriptTokens.slice(0, 25).join(" "), whisperHead: words.slice(0, 25).map((w) => w.text).join(" "),
    });
  }
  if (req.nextUrl.searchParams.get("format") === "text") {
    const lines: string[] = [];
    for (const r of rows) {
      lines.push(`\n=== #${r.projectId} draft ${r.draftId} · ${r.client} (${r.language}) · ${r.title}`);
      lines.push(`whisper ${r.whisperWords} words · script ${r.scriptTokens} tokens · ratio ${r.ratio} (matched ${r.matched}, substituted ${r.substituted}, improvised ${r.improvised}, skipped ${r.skipped}) · script coverage ${r.lcsCoverageOfScript}`);
      lines.push(`with digits as words ${r.ratioWithDigitsAsWords} · loose plurals ${r.ratioLoosePlurals}`);
      lines.push(`script head : ${r.scriptHead}`);
      lines.push(`whisper head: ${r.whisperHead}`);
      lines.push(`unmatched whisper: ${r.unmatchedWhisperTop.join(" ")}`);
      lines.push(`unmatched script : ${r.unmatchedScriptTop.join(" ")}`);
      for (const s of r.failureSamples) lines.push(`  · ${s}`);
    }
    return new NextResponse(lines.join("\n") || "No project with a transcript yet.", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return NextResponse.json({ rows });
}
