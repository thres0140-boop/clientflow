// Pure timeline operations on an EditDocument. Every function returns a NEW document (the editor
// keeps an undo stack of documents) and re-derives the main-track invariant through
// normalizeDocument, so `at` is never edited by hand.
import { type CaptionCue, type EditDocument, IDENTITY_TRANSFORM, type Ms, newId, normalizeDocument, type TextElement, type Track, type Transition, TRANSITION_DEFAULT_MS, TRANSITION_MAX_SHARE, type TransitionType, type VideoClip, type VideoTrack } from "./document";
import { type CaptionStyle } from "./captionStyle";

export const MIN_CLIP_MS = 100;

export function mainTrack(doc: EditDocument): VideoTrack {
  return doc.tracks.find((t): t is VideoTrack => t.kind === "video" && t.role === "main")!;
}
export function overlayTrack(doc: EditDocument): VideoTrack | undefined {
  return doc.tracks.find((t): t is VideoTrack => t.kind === "video" && t.role === "overlay");
}
export function captionTrack(doc: EditDocument) {
  return doc.tracks.find((t) => t.kind === "caption");
}
export function textTrack(doc: EditDocument) {
  return doc.tracks.find((t) => t.kind === "text");
}
export function clipLengthMs(c: VideoClip): Ms {
  return c.outMs - c.inMs;
}

function mapTracks(doc: EditDocument, f: (t: Track) => Track): EditDocument {
  return normalizeDocument({ ...doc, tracks: doc.tracks.map(f) });
}
function mapClips(doc: EditDocument, trackId: string, f: (clips: VideoClip[]) => VideoClip[]): EditDocument {
  return mapTracks(doc, (t) => (t.kind === "video" && t.id === trackId ? { ...t, clips: f(t.clips) } : t));
}

/** A freshly created project has 0-length placeholder clips; once the browser knows an asset's
 *  duration, every placeholder for it becomes the whole asset. */
export function applyAssetMetadata(doc: EditDocument, assetId: string, meta: { durationMs: number; width: number; height: number }): EditDocument {
  const durationMs = Math.max(0, Math.round(meta.durationMs));
  const next: EditDocument = {
    ...doc,
    assets: doc.assets.map((a) => (a.id === assetId ? { ...a, durationMs, width: meta.width, height: meta.height } : a)),
    tracks: doc.tracks.map((t) => (t.kind === "video" ? { ...t, clips: t.clips.map((c) => (c.assetId === assetId && c.outMs === 0 ? { ...c, inMs: 0, outMs: durationMs } : c)) } : t)),
  };
  return normalizeDocument(next);
}

/** The main clip under a timeline time, and the source time inside its asset. Where two clips
 *  overlap in a transition, the INCOMING clip wins: it is the clock from the moment it starts. */
export function clipAt(track: VideoTrack, tMs: Ms): { clip: VideoClip; sourceMs: Ms; index: number } | null {
  for (let i = track.clips.length - 1; i >= 0; i--) {
    const c = track.clips[i];
    const len = clipLengthMs(c);
    if (tMs >= c.at && (tMs < c.at + len || (i === track.clips.length - 1 && tMs === c.at + len))) {
      return { clip: c, sourceMs: c.inMs + Math.min(len, tMs - c.at), index: i };
    }
  }
  return null;
}

/** The transition (if any) in progress at `tMs`: the outgoing and incoming clips and the 0..1 progress. */
export function transitionAt(track: VideoTrack, tMs: Ms): { transition: Transition; out: VideoClip; into: VideoClip; progress: number } | null {
  for (const tr of track.transitions) {
    const i = track.clips.findIndex((c) => c.id === tr.afterClipId);
    const out = track.clips[i], into = track.clips[i + 1];
    if (!out || !into) continue;
    if (tMs >= into.at && tMs < into.at + tr.durationMs) return { transition: tr, out, into, progress: (tMs - into.at) / tr.durationMs };
  }
  return null;
}

/** The longest a transition after `clipId` may be: half the shorter neighbour. 0 = no boundary. */
export function transitionCapMs(track: VideoTrack, clipId: string): Ms {
  const i = track.clips.findIndex((c) => c.id === clipId);
  const a = track.clips[i], b = track.clips[i + 1];
  if (!a || !b) return 0;
  return Math.floor(Math.min(clipLengthMs(a), clipLengthMs(b)) * TRANSITION_MAX_SHARE);
}

export function transitionAfter(track: VideoTrack, clipId: string): Transition | undefined {
  return track.transitions.find((t) => t.afterClipId === clipId);
}

/** Sets (or replaces) the transition at the boundary after `clipId`; `type` null removes it. */
export function setTransition(doc: EditDocument, clipId: string, type: TransitionType | null, durationMs?: Ms): EditDocument {
  return mapTracks(doc, (t) => {
    if (t.kind !== "video" || t.role !== "main") return t;
    const rest = t.transitions.filter((x) => x.afterClipId !== clipId);
    if (!type) return { ...t, transitions: rest };
    const existing = t.transitions.find((x) => x.afterClipId === clipId);
    const cap = transitionCapMs(t, clipId);
    const d = Math.min(cap, durationMs ?? existing?.durationMs ?? TRANSITION_DEFAULT_MS);
    return { ...t, transitions: [...rest, { id: existing?.id ?? newId("x"), afterClipId: clipId, type, durationMs: d }] };
  });
}

/** Applies one transition type (default duration, capped per boundary) to every boundary. */
export function setAllTransitions(doc: EditDocument, type: TransitionType | null, durationMs = TRANSITION_DEFAULT_MS): EditDocument {
  let d = doc;
  const clips = mainTrack(doc).clips;
  for (let i = 0; i < clips.length - 1; i++) d = setTransition(d, clips[i].id, type, durationMs);
  return d;
}

/** Trim by dragging an edge. `edge=start` moves inMs (the clip's timeline position follows for
 *  the main track, or stays put for overlays where `at` shifts by the same amount). */
export function trimClip(doc: EditDocument, trackId: string, clipId: string, edge: "start" | "end", deltaMs: Ms): EditDocument {
  return mapClips(doc, trackId, (clips) => clips.map((c) => {
    if (c.id !== clipId) return c;
    const asset = doc.assets.find((a) => a.id === c.assetId);
    const max = asset?.durationMs ?? c.outMs;
    if (edge === "start") {
      const inMs = Math.min(c.outMs - MIN_CLIP_MS, Math.max(0, c.inMs + deltaMs));
      return { ...c, inMs, at: Math.max(0, c.at + (inMs - c.inMs)) };
    }
    const outMs = Math.max(c.inMs + MIN_CLIP_MS, Math.min(max, c.outMs + deltaMs));
    return { ...c, outMs };
  }));
}

/** Splits the clip under tMs into two at that frame. No-op within MIN_CLIP_MS of an edge. A
 *  transition that sat after the split clip moves to sit after its second half. */
export function splitClipAt(doc: EditDocument, trackId: string, tMs: Ms): EditDocument {
  let movedFrom: string | null = null, movedTo: string | null = null;
  const next = mapClips(doc, trackId, (clips) => {
    const out: VideoClip[] = [];
    for (const c of clips) {
      const len = clipLengthMs(c);
      const local = tMs - c.at;
      if (local > MIN_CLIP_MS && local < len - MIN_CLIP_MS) {
        const cut = c.inMs + Math.round(local);
        const second = { ...c, id: newId("c"), inMs: cut, at: c.at + Math.round(local) };
        out.push({ ...c, outMs: cut }, second);
        movedFrom = c.id; movedTo = second.id;
      } else out.push(c);
    }
    return out;
  });
  if (!movedFrom || !movedTo) return next;
  const from = movedFrom, to = movedTo;
  return mapTracks(next, (t) => (t.kind === "video" && t.id === trackId ? { ...t, transitions: t.transitions.map((x) => (x.afterClipId === from ? { ...x, afterClipId: to } : x)) } : t));
}

/** Trim a clip AT a timeline time: "left" discards everything before tMs, "right" everything
 *  after it. No-op (same document by identity) if tMs is outside the clip or the remainder
 *  would be shorter than MIN_CLIP_MS, so callers can skip the undo entry. */
export function trimClipToTime(doc: EditDocument, trackId: string, clipId: string, tMs: Ms, side: "left" | "right"): EditDocument {
  const track = doc.tracks.find((t): t is VideoTrack => t.kind === "video" && t.id === trackId);
  const c = track?.clips.find((x) => x.id === clipId);
  if (!c) return doc;
  const local = tMs - c.at;
  const len = clipLengthMs(c);
  if (local <= 0 || local >= len) return doc;
  if (side === "left" ? len - local < MIN_CLIP_MS : local < MIN_CLIP_MS) return doc;
  const cut = Math.round(local);
  return mapClips(doc, trackId, (clips) => clips.map((x) => (x.id !== clipId ? x : side === "left" ? { ...x, inMs: x.inMs + cut, at: x.at + cut } : { ...x, outMs: x.inMs + cut })));
}

// ── snapping ──────────────────────────────────────────────────────────────────

/** Every time an edge can snap to: timeline start, the playhead, and the start/end of every
 *  clip, cue and text element except the ones being dragged. */
export function snapCandidates(doc: EditDocument, exclude: ReadonlySet<string>, playheadMs: Ms): Ms[] {
  const out = new Set<Ms>([0, playheadMs]);
  for (const t of doc.tracks) {
    if (t.kind === "video") for (const c of t.clips) { if (!exclude.has(c.id)) { out.add(c.at); out.add(c.at + clipLengthMs(c)); } }
    else if (t.kind === "caption") for (const q of t.cues) { if (!exclude.has(q.id)) { out.add(q.startMs); out.add(q.endMs); } }
    else for (const e of t.elements) { if (!exclude.has(e.id)) { out.add(e.startMs); out.add(e.endMs); } }
  }
  return [...out].sort((a, b) => a - b);
}

/** Adjusts a drag delta so that the nearest of the moving `edges` (their times BEFORE the
 *  drag) lands on a candidate within `thresholdMs`. Returns the delta unchanged if none is near. */
export function snapDelta(edges: Ms[], deltaMs: Ms, candidates: Ms[], thresholdMs: Ms): Ms {
  let best: { dist: number; adjust: Ms } | null = null;
  for (const e of edges) {
    const moved = e + deltaMs;
    for (const c of candidates) {
      const dist = Math.abs(c - moved);
      if (dist <= thresholdMs && (!best || dist < best.dist)) best = { dist, adjust: c - moved };
    }
  }
  return best ? deltaMs + best.adjust : deltaMs;
}

/** Snaps a single time (the playhead while scrubbing) to the nearest candidate within reach. */
export function snapTime(tMs: Ms, candidates: Ms[], thresholdMs: Ms): Ms {
  let best: Ms | null = null, bestDist = Infinity;
  for (const c of candidates) { const d = Math.abs(c - tMs); if (d <= thresholdMs && d < bestDist) { best = c; bestDist = d; } }
  return best ?? tMs;
}

export function deleteClip(doc: EditDocument, trackId: string, clipId: string): EditDocument {
  return mapClips(doc, trackId, (clips) => clips.filter((c) => c.id !== clipId));
}

/** Reorders a main-track clip to index `to` (overlays are moved by `at` instead). */
export function moveClip(doc: EditDocument, trackId: string, clipId: string, to: number): EditDocument {
  return mapClips(doc, trackId, (clips) => {
    const from = clips.findIndex((c) => c.id === clipId);
    if (from < 0) return clips;
    const next = clips.slice();
    const [c] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, c);
    return next;
  });
}

export function setClipAt(doc: EditDocument, trackId: string, clipId: string, at: Ms): EditDocument {
  return mapClips(doc, trackId, (clips) => clips.map((c) => (c.id === clipId ? { ...c, at: Math.max(0, Math.round(at)) } : c)));
}

export function updateClip(doc: EditDocument, trackId: string, clipId: string, patch: Partial<VideoClip>): EditDocument {
  return mapClips(doc, trackId, (clips) => clips.map((c) => (c.id === clipId ? { ...c, ...patch, id: c.id, assetId: c.assetId } : c)));
}

/** Adds an asset (a raw clip or a freshly uploaded file) to a track at `at`. The main track
 *  ignores `at` and appends. */
export function addClip(doc: EditDocument, trackId: string, assetId: string, at: Ms): EditDocument {
  const asset = doc.assets.find((a) => a.id === assetId);
  if (!asset) return doc;
  const clip: VideoClip = { id: newId("c"), assetId, at: Math.max(0, Math.round(at)), inMs: 0, outMs: asset.durationMs ?? 0, transform: { ...IDENTITY_TRANSFORM }, muted: false, volume: 1 };
  return mapClips(doc, trackId, (clips) => [...clips, clip]);
}

/** Drops an asset and every clip that used it (a clip whose media is gone for good). */
export function removeAsset(doc: EditDocument, assetId: string): EditDocument {
  return normalizeDocument({ ...doc, assets: doc.assets.filter((a) => a.id !== assetId), tracks: doc.tracks.map((t) => (t.kind === "video" ? { ...t, clips: t.clips.filter((c) => c.assetId !== assetId) } : t)) });
}

export function addAsset(doc: EditDocument, asset: { url: string; name: string; kind?: "video" | "image" }): { doc: EditDocument; assetId: string } {
  const id = newId("a");
  return { doc: normalizeDocument({ ...doc, assets: [...doc.assets, { id, kind: asset.kind ?? "video", url: asset.url, name: asset.name, durationMs: null, width: null, height: null }] }), assetId: id };
}

// ── captions ──────────────────────────────────────────────────────────────────

export function addCue(doc: EditDocument, cue: Omit<CaptionCue, "id">): EditDocument {
  return mapTracks(doc, (t) => (t.kind === "caption" ? { ...t, cues: [...t.cues, { ...cue, id: newId("q") }].sort((a, b) => a.startMs - b.startMs) } : t));
}
export function updateCue(doc: EditDocument, cueId: string, patch: Partial<Omit<CaptionCue, "id">>): EditDocument {
  return mapTracks(doc, (t) => (t.kind === "caption" ? { ...t, cues: t.cues.map((q) => (q.id === cueId ? { ...q, ...patch } : q)).sort((a, b) => a.startMs - b.startMs) } : t));
}
export function deleteCue(doc: EditDocument, cueId: string): EditDocument {
  return mapTracks(doc, (t) => (t.kind === "caption" ? { ...t, cues: t.cues.filter((q) => q.id !== cueId) } : t));
}
export function replaceCues(doc: EditDocument, cues: Omit<CaptionCue, "id">[]): EditDocument {
  return mapTracks(doc, (t) => (t.kind === "caption" ? { ...t, cues: cues.map((q) => ({ ...q, id: newId("q") })) } : t));
}
export function cueAt(doc: EditDocument, tMs: Ms): CaptionCue | null {
  const t = captionTrack(doc);
  if (!t || t.kind !== "caption") return null;
  return t.cues.find((q) => tMs >= q.startMs && tMs < q.endMs) ?? null;
}

// ── text ──────────────────────────────────────────────────────────────────────

export function addText(doc: EditDocument, el: Omit<TextElement, "id">): { doc: EditDocument; id: string } {
  const id = newId("x");
  return { doc: mapTracks(doc, (t) => (t.kind === "text" ? { ...t, elements: [...t.elements, { ...el, id }] } : t)), id };
}
export function updateText(doc: EditDocument, id: string, patch: Partial<Omit<TextElement, "id">>): EditDocument {
  return mapTracks(doc, (t) => (t.kind === "text" ? { ...t, elements: t.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)) } : t));
}
export function deleteText(doc: EditDocument, id: string): EditDocument {
  return mapTracks(doc, (t) => (t.kind === "text" ? { ...t, elements: t.elements.filter((e) => e.id !== id) } : t));
}

export function setTranscript(doc: EditDocument, transcript: EditDocument["transcript"]): EditDocument {
  return normalizeDocument({ ...doc, transcript });
}

export function setCaptionStyle(doc: EditDocument, style: CaptionStyle): EditDocument {
  return normalizeDocument({ ...doc, captionStyle: style });
}

/** Cues from a flat word list: `wordsPerCue` words per cue, one line (Phase 3 also wraps by
 *  maxLines). Exposed now so the caption panel can chunk manually typed words. */
export function cuesFromWords(words: { text: string; startMs: Ms; endMs: Ms }[], wordsPerCue: number): Omit<CaptionCue, "id">[] {
  const out: Omit<CaptionCue, "id">[] = [];
  for (let i = 0; i < words.length; i += wordsPerCue) {
    const chunk = words.slice(i, i + wordsPerCue);
    out.push({ startMs: chunk[0].startMs, endMs: chunk[chunk.length - 1].endMs, lines: [chunk.map((w) => w.text).join(" ")], words: chunk.map((w) => ({ ...w })), styleOverride: null });
  }
  return out;
}
