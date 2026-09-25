// Script alignment: Whisper says WHEN each word was spoken, the draft's script says WHAT the
// person meant to say. A sequence alignment (longest common subsequence over normalised tokens)
// pairs them; matched words take the script's spelling with Whisper's timing; a lone unmatched
// Whisper word between two matches facing a lone unmatched script word is a mishearing and takes
// the script word too; runs of unmatched Whisper words are improvisation and stay as heard;
// runs of unmatched script words were skipped and are dropped. If too little matches, the
// speaker did not follow the script and the caller should keep the plain transcript.
import type { TranscriptWord } from "./document";

export type AlignResult = { words: TranscriptWord[]; matched: number; substituted: number; improvised: number; skipped: number; ratio: number };

/** Lowercase, strip accents and punctuation, so "Coach!" and "coach" and "Coäch" compare equal. */
export function normalizeToken(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9€$%]+/g, "");
}

export function tokenizeScript(text: string): string[] {
  return text.replace(/\s+/g, " ").split(" ").map((t) => t.trim()).filter((t) => normalizeToken(t).length > 0);
}

/** LCS alignment with a band to keep long scripts cheap; returns index pairs (whisper i, script j). */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  // O(n·m) is fine here: a 15-minute reel is ~2,500 words; 2,500² int16 cells is 12 MB.
  const dp = new Uint16Array((n + 1) * (m + 1));
  const idx = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[idx(i, j)] = a[i] === b[j] ? dp[idx(i + 1, j + 1)] + 1 : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
  }
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) i++;
    else j++;
  }
  return pairs;
}

/** Aligns Whisper's timed words to the script's words. `minRatio` is the share of Whisper words
 *  that must match (or be one-for-one substitutions) for the result to be trusted. */
export function alignToScript(whisper: TranscriptWord[], script: string, minRatio = 0.6): AlignResult | null {
  const scriptTokens = tokenizeScript(script);
  if (whisper.length === 0 || scriptTokens.length === 0) return null;
  const a = whisper.map((w) => normalizeToken(w.text));
  const b = scriptTokens.map(normalizeToken);
  const pairs = lcsPairs(a, b);
  const out: TranscriptWord[] = [];
  let matched = 0, substituted = 0, improvised = 0, skipped = 0;
  let pi = 0, pj = 0; // cursors into whisper / script
  const emit = (w: TranscriptWord, text: string) => out.push({ text, startMs: w.startMs, endMs: w.endMs });
  for (let k = 0; k <= pairs.length; k++) {
    const [ni, nj] = k < pairs.length ? pairs[k] : [whisper.length, scriptTokens.length];
    const gapW = ni - pi, gapS = nj - pj;
    if (gapW === gapS && gapW > 0 && gapW <= 2) {
      // Equal-length gaps: mishearings, one for one — the script's word with Whisper's timing.
      for (let x = 0; x < gapW; x++) { emit(whisper[pi + x], scriptTokens[pj + x]); substituted++; }
    } else {
      // Otherwise the speaker improvised (keep what was heard) and/or skipped script (drop it).
      for (let x = pi; x < ni; x++) { emit(whisper[x], whisper[x].text); improvised++; }
      skipped += gapS;
    }
    if (k < pairs.length) { emit(whisper[ni], scriptTokens[nj]); matched++; pi = ni + 1; pj = nj + 1; }
  }
  const ratio = (matched + substituted) / whisper.length;
  if (ratio < minRatio) return { words: whisper, matched, substituted, improvised, skipped, ratio };
  return { words: out, matched, substituted, improvised, skipped, ratio };
}
