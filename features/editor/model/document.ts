// The edit project document: one JSON blob per EditProject (stored as a String column, read with
// JSON.parse, like every other JSON column in this app). It is the whole editor state, so that a
// reload, another device or another person resumes exactly where the last save left off.
//
// Units: all times are integer milliseconds on the timeline (`at`) or in the source asset
// (`inMs`/`outMs`); all positions are fractions of the canvas (0..1) so a document does not care
// what size it is previewed at; all sizes that must match the export (captions) are canvas px.
//
// Client-safe: no server imports.
import { type CaptionStyle, DEFAULT_CAPTION_STYLE, normalizeCaptionStyle } from "./captionStyle";

export const EDIT_DOCUMENT_VERSION = 1 as const;
export const DEFAULT_CANVAS = { width: 1080, height: 1920, fps: 30 } as const;

export type Ms = number;

export type Asset = {
  id: string;
  kind: "video" | "image";
  url: string;                 // the R2 url exactly as stored on the draft (proxy at playback with videoSrc())
  name: string;
  durationMs: Ms | null;       // null until the browser has loaded metadata (Phase 2 fills it in)
  width: number | null;
  height: number | null;
};

/** Where and how a clip or text sits on the canvas. x/y are the element's CENTRE as a fraction of
 *  the canvas; scale 1 = "fit the canvas height"; rotation in degrees; opacity 0..1. */
export type Transform = { x: number; y: number; scale: number; rotation: number; opacity: number };
export const IDENTITY_TRANSFORM: Transform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };

export type VideoClip = {
  id: string;
  assetId: string;
  at: Ms;                      // timeline position of the clip's first frame
  inMs: Ms;                    // trim: first source ms shown
  outMs: Ms;                   // trim: source ms after the last one shown (outMs - inMs = clip length)
  transform: Transform;
  muted: boolean;
  volume: number;              // 0..1, ignored when muted
};

/** The main track is the spine of the timeline: clips play back to back with no gaps, in array
 *  order, and `at` is derived from the clips before it (normalizeDocument rewrites it). Overlay
 *  tracks (b-roll) place clips freely by `at` and draw above the main track. */
export type VideoTrack = { id: string; kind: "video"; role: "main" | "overlay"; clips: VideoClip[] };

export type CaptionWord = { text: string; startMs: Ms; endMs: Ms };
export type CaptionCue = {
  id: string;
  startMs: Ms;
  endMs: Ms;
  lines: string[];             // explicit lines (already wrapped); both renderers draw exactly these
  words: CaptionWord[] | null; // word timing inside the cue, for highlight.mode=color; null = none
};
/** Captions take their look from document.captionStyle; a track can override parts of it. */
export type CaptionTrack = { id: string; kind: "caption"; cues: CaptionCue[]; styleOverride: Partial<CaptionStyle> | null };

/** Free text on screen (a title, a label). Its look is a full CaptionStyle of its own so the
 *  same two renderers draw it; position comes from the transform, not from layout.anchor. */
export type TextElement = { id: string; text: string; startMs: Ms; endMs: Ms; style: CaptionStyle; transform: Transform };
export type TextTrack = { id: string; kind: "text"; elements: TextElement[] };

export type Track = VideoTrack | CaptionTrack | TextTrack;

export type TranscriptWord = { text: string; startMs: Ms; endMs: Ms };
/** Kept in the document so captions can be re-chunked with a different wordsPerCue without
 *  re-running Whisper. Filled by Phase 3. */
export type Transcript = { source: "whisper-1"; language: string | null; words: TranscriptWord[]; createdAt: string };

export type EditDocument = {
  v: typeof EDIT_DOCUMENT_VERSION;
  canvas: { width: number; height: number; fps: number };
  assets: Asset[];
  tracks: Track[];             // draw order bottom → top; exactly one video track with role "main"
  captionStyle: CaptionStyle;
  transcript: Transcript | null;
};

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 1000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** A fresh document for a draft: every raw clip becomes an asset and a back-to-back clip on the
 *  main track, in upload order. Durations are unknown until the browser reads them, so each
 *  clip starts as a 0-length placeholder that Phase 2 expands on metadata load. */
export function createDocumentFromRawUrls(rawUrls: string[], captionStyle: CaptionStyle = DEFAULT_CAPTION_STYLE): EditDocument {
  const assets: Asset[] = rawUrls.filter((u) => typeof u === "string" && u).map((url, i) => ({
    id: newId("a"), kind: "video", url, name: `Clip ${i + 1}`, durationMs: null, width: null, height: null,
  }));
  const main: VideoTrack = {
    id: newId("t"), kind: "video", role: "main",
    clips: assets.map((a) => ({ id: newId("c"), assetId: a.id, at: 0, inMs: 0, outMs: 0, transform: { ...IDENTITY_TRANSFORM }, muted: false, volume: 1 })),
  };
  return {
    v: EDIT_DOCUMENT_VERSION,
    canvas: { ...DEFAULT_CANVAS },
    assets,
    tracks: [main, { id: newId("t"), kind: "video", role: "overlay", clips: [] }, { id: newId("t"), kind: "caption", cues: [], styleOverride: null }, { id: newId("t"), kind: "text", elements: [] }],
    captionStyle,
    transcript: null,
  };
}

/** Length of the timeline = the end of the main track (overlays and captions cannot extend it). */
export function documentDurationMs(doc: EditDocument): Ms {
  const main = doc.tracks.find((t): t is VideoTrack => t.kind === "video" && t.role === "main");
  if (!main || main.clips.length === 0) return 0;
  const last = main.clips[main.clips.length - 1];
  return last.at + (last.outMs - last.inMs);
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const ms = (n: unknown, d = 0): Ms => (isNum(n) ? Math.max(0, Math.round(n)) : d);
const str = (s: unknown, d = ""): string => (typeof s === "string" ? s : d);
function transform(t: unknown): Transform {
  const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
  return {
    x: isNum(o.x) ? o.x : 0.5, y: isNum(o.y) ? o.y : 0.5,
    scale: isNum(o.scale) && o.scale > 0 ? o.scale : 1,
    rotation: isNum(o.rotation) ? o.rotation : 0,
    opacity: isNum(o.opacity) ? Math.min(1, Math.max(0, o.opacity)) : 1,
  };
}

/** Coerces whatever is in the column into a valid document and re-derives the invariants:
 *  main-track clips are contiguous and `at` follows from their lengths; every clip points at an
 *  asset that exists; there is exactly one main track. Garbage in → a valid empty document out,
 *  never a throw, so a corrupted row cannot brick the editor. */
export function normalizeDocument(input: unknown): EditDocument {
  const d = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const canvas = { width: isNum(d.canvas?.width) ? d.canvas.width : DEFAULT_CANVAS.width, height: isNum(d.canvas?.height) ? d.canvas.height : DEFAULT_CANVAS.height, fps: isNum(d.canvas?.fps) ? d.canvas.fps : DEFAULT_CANVAS.fps };
  const assets: Asset[] = (Array.isArray(d.assets) ? d.assets : []).filter((a: any) => a && typeof a.id === "string" && typeof a.url === "string").map((a: any) => ({
    id: a.id, kind: a.kind === "image" ? "image" : "video", url: a.url, name: str(a.name, "Clip"),
    durationMs: isNum(a.durationMs) ? Math.round(a.durationMs) : null, width: isNum(a.width) ? a.width : null, height: isNum(a.height) ? a.height : null,
  }));
  const assetIds = new Set(assets.map((a) => a.id));
  const clip = (c: any): VideoClip | null => {
    if (!c || typeof c.id !== "string" || !assetIds.has(c.assetId)) return null;
    const inMs = ms(c.inMs), outMs = Math.max(inMs, ms(c.outMs));
    return { id: c.id, assetId: c.assetId, at: ms(c.at), inMs, outMs, transform: transform(c.transform), muted: !!c.muted, volume: isNum(c.volume) ? Math.min(1, Math.max(0, c.volume)) : 1 };
  };
  const captionStyle = normalizeCaptionStyle(d.captionStyle);
  const tracks: Track[] = [];
  let sawMain = false;
  for (const t of Array.isArray(d.tracks) ? d.tracks : []) {
    if (!t || typeof t.id !== "string") continue;
    if (t.kind === "video") {
      const role = t.role === "main" && !sawMain ? "main" : "overlay";
      if (role === "main") sawMain = true;
      tracks.push({ id: t.id, kind: "video", role, clips: (Array.isArray(t.clips) ? t.clips : []).map(clip).filter((c: VideoClip | null): c is VideoClip => !!c) });
    } else if (t.kind === "caption") {
      const cues: CaptionCue[] = (Array.isArray(t.cues) ? t.cues : []).filter((c: any) => c && typeof c.id === "string").map((c: any) => {
        const startMs = ms(c.startMs), endMs = Math.max(startMs, ms(c.endMs));
        const lines = Array.isArray(c.lines) ? c.lines.map((l: unknown) => str(l)).slice(0, 3) : typeof c.text === "string" ? [c.text] : [];
        const words = Array.isArray(c.words) ? c.words.filter((w: any) => w && typeof w.text === "string").map((w: any) => ({ text: w.text, startMs: ms(w.startMs), endMs: ms(w.endMs) })) : null;
        return { id: c.id, startMs, endMs, lines, words: words && words.length ? words : null };
      });
      tracks.push({ id: t.id, kind: "caption", cues, styleOverride: t.styleOverride && typeof t.styleOverride === "object" ? t.styleOverride : null });
    } else if (t.kind === "text") {
      const elements: TextElement[] = (Array.isArray(t.elements) ? t.elements : []).filter((e: any) => e && typeof e.id === "string").map((e: any) => {
        const startMs = ms(e.startMs), endMs = Math.max(startMs, ms(e.endMs));
        return { id: e.id, text: str(e.text), startMs, endMs, style: normalizeCaptionStyle(e.style, captionStyle), transform: transform(e.transform) };
      });
      tracks.push({ id: t.id, kind: "text", elements });
    }
  }
  if (!sawMain) tracks.unshift({ id: newId("t"), kind: "video", role: "main", clips: [] });
  // Invariant: the main track is contiguous; `at` is derived, never trusted from storage.
  for (const t of tracks) {
    if (t.kind === "video" && t.role === "main") {
      let cursor = 0;
      for (const c of t.clips) { c.at = cursor; cursor += c.outMs - c.inMs; }
    }
  }
  let transcript: Transcript | null = null;
  if (d.transcript && Array.isArray(d.transcript.words)) {
    transcript = {
      source: "whisper-1", language: typeof d.transcript.language === "string" ? d.transcript.language : null,
      words: d.transcript.words.filter((w: any) => w && typeof w.text === "string").map((w: any) => ({ text: w.text, startMs: ms(w.startMs), endMs: ms(w.endMs) })),
      createdAt: str(d.transcript.createdAt, new Date().toISOString()),
    };
  }
  return { v: EDIT_DOCUMENT_VERSION, canvas, assets, tracks, captionStyle, transcript };
}

/** Parses the stored column. An empty / unparsable column yields an empty valid document. */
export function parseDocument(column: string | null | undefined): EditDocument {
  if (!column) return normalizeDocument({});
  try { return normalizeDocument(JSON.parse(column)); } catch { return normalizeDocument({}); }
}
