// Turning timed words into caption cues, honouring the caption style's wordsPerCue and maxLines,
// and mapping per-asset transcripts onto the timeline through the main track's clips. Pure and
// client-safe: re-chunking after a style change never needs the server.
import type { AssetTranscript, CaptionCue, EditDocument, Ms, TranscriptWord } from "./document";
import type { CaptionStyle } from "./captionStyle";
import { clipLengthMs, mainTrack } from "./timeline";

export type TimelineWord = TranscriptWord & { assetId: string };

/** Words in TIMELINE time: each asset's words, placed through every main-track clip that shows
 *  that part of the asset (a clip trimmed to 2–6 s only contributes the words inside 2–6 s). */
export function timelineWords(doc: EditDocument, transcripts: AssetTranscript[]): TimelineWord[] {
  const byAsset = new Map(transcripts.map((t) => [t.assetId, t.words]));
  const out: TimelineWord[] = [];
  for (const c of mainTrack(doc).clips) {
    const words = byAsset.get(c.assetId);
    if (!words) continue;
    for (const w of words) {
      const mid = (w.startMs + w.endMs) / 2;
      if (mid < c.inMs || mid >= c.outMs) continue;
      out.push({ assetId: c.assetId, text: w.text, startMs: c.at + Math.max(0, w.startMs - c.inMs), endMs: c.at + Math.min(clipLengthMs(c), w.endMs - c.inMs) });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

const PAUSE_BREAK_MS = 900;   // a silence this long ends the current cue early
const MIN_CUE_MS = 400;       // a cue never flashes shorter than this (extended into the following gap)
const MAX_HOLD_MS = 350;      // and never lingers longer than this into a silence

/** Groups words into cues: `wordsPerCue` per cue, a long pause ends a cue early, and the words
 *  are spread over up to `maxLines` explicit lines (both renderers draw exactly these lines).
 *  Uppercasing is NOT applied here: it is a style property applied at draw time on both sides. */
export function layoutCaptions(words: TranscriptWord[], style: CaptionStyle): Omit<CaptionCue, "id">[] {
  const per = Math.max(1, Math.round(style.layout.wordsPerCue));
  const maxLines = style.layout.maxLines;
  const groups: TranscriptWord[][] = [];
  let cur: TranscriptWord[] = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (cur.length >= per || (prev && w.startMs - prev.endMs > PAUSE_BREAK_MS)) { groups.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);

  const cues = groups.map((g) => ({
    startMs: g[0].startMs,
    endMs: Math.max(g[g.length - 1].endMs, g[0].startMs + MIN_CUE_MS),
    lines: splitLines(g.map((w) => w.text), maxLines),
    words: g.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs })),
    styleOverride: null,
  }));
  // Fill small gaps so captions do not flicker, but never overlap the next cue.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    const wanted = cues[i].endMs + MAX_HOLD_MS;
    cues[i].endMs = next ? Math.min(Math.max(cues[i].endMs, Math.min(wanted, next.startMs)), next.startMs) : wanted;
    if (next && cues[i].endMs > next.startMs) cues[i].endMs = next.startMs;
  }
  return cues;
}

/** Spreads words over up to `maxLines` lines, balanced by character count. One line for short
 *  cues; a second (or third) line only when there is enough text to justify it. */
export function splitLines(tokens: string[], maxLines: 1 | 2 | 3): string[] {
  if (maxLines === 1 || tokens.length < 4) return [tokens.join(" ")];
  const lines = Math.min(maxLines, tokens.length >= 7 ? 3 : 2);
  const total = tokens.join(" ").length;
  const target = total / lines;
  const out: string[] = [];
  let line: string[] = [], len = 0;
  for (const t of tokens) {
    if (line.length && len + 1 + t.length > target && out.length < lines - 1) { out.push(line.join(" ")); line = []; len = 0; }
    line.push(t); len += (len ? 1 : 0) + t.length;
  }
  if (line.length) out.push(line.join(" "));
  return out;
}

/** Duration of audio that a transcript run covers, for the ceiling check. */
export function mainTrackAudioMs(doc: EditDocument): Ms {
  return mainTrack(doc).clips.reduce((s, c) => s + clipLengthMs(c), 0);
}
