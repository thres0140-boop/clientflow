"use client";

// The timeline: ruler, playhead and four tracks (text, captions, b-roll, main). All edits are
// pointer drags that preview live through onChange(doc, false) and commit on release with
// onChange(doc, true), so the undo stack gets one entry per gesture. With `snap` on, the moving
// edge of a drag and the scrubbed playhead snap to clip/cue/text edges and to the playhead.
// The panel scrolls in both directions inside itself: the ruler is pinned to the top and the
// track labels to the left, so every track is reachable at any panel height.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditDocument, Ms } from "@/features/editor/model/document";
import { filmstrip, THUMB_H, THUMB_W, useFilmstripVersion, WAVE_H } from "./useFilmstrip";
import { captionTrack, clipLengthMs, mainTrack, moveClip, overlayTrack, setClipAt, snapCandidates, snapDelta, snapTime, textTrack, transitionAfter, trimClip, updateCue, updateText } from "@/features/editor/model/timeline";
import { TRANSITION_LABELS } from "./transitions";
import type { AssetStatus } from "./usePlayback";

export type Selection =
  | { kind: "clip"; trackId: string; id: string }
  | { kind: "cue"; id: string }
  | { kind: "text"; id: string }
  | { kind: "transition"; afterClipId: string } // a boundary on the main track, with or without a transition yet
  | null;

type Props = {
  doc: EditDocument;
  projectId: number;
  playing: boolean;
  tMs: Ms;
  durationMs: Ms;
  pxPerSec: number;
  selection: Selection;
  assetStatus: Record<string, AssetStatus>;
  snap: boolean;
  onZoom: (pxPerSec: number) => void;
  onSeek: (t: Ms) => void;
  onSelect: (s: Selection) => void;
  onChange: (doc: EditDocument, commit: boolean) => void;
};

const LABEL_W = 123;                       // CapCut's track header column
const ROW_TEXT = 22, ROW_CAPTION = 30, ROW_OVERLAY = 30, ROW_MAIN = 74; // CapCut's row heights
const ROW_H = ROW_CAPTION;
const STRIP_H = 17;                        // the name strip on a video clip, above the filmstrip
const VIEW_MARGIN = 300;                   // px of filmstrip drawn beyond the visible window
const SNAP_PX = 8;
export const ZOOM_MIN = 10, ZOOM_MAX = 400; // px per second

export function fmtTime(ms: Ms): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
}

export default function Timeline({ doc, projectId, playing, tMs, durationMs, pxPerSec, selection, assetStatus, snap, onZoom, onSeek, onSelect, onChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Filmstrips draw only the visible window (a 15-minute clip at max zoom is 360k px wide), so the
  // scrolled range is tracked here in 100 px steps; thumbnails are requested for that window only.
  const [view, setView] = useState({ from: 0, to: 2400 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const from = Math.floor((el.scrollLeft - VIEW_MARGIN) / 100) * 100;
      const to = Math.ceil((el.scrollLeft + el.clientWidth - LABEL_W + VIEW_MARGIN) / 100) * 100;
      setView((v) => (v.from === from && v.to === to ? v : { from, to }));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    onScroll();
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  // Thumbnail seeking competes with playback decode, so the filmstrip queue waits while playing.
  useEffect(() => { filmstrip.setPaused(playing); }, [playing]);
  const filmVersion = useFilmstripVersion();
  const zoomRef = useRef(pxPerSec);
  useEffect(() => { zoomRef.current = pxPerSec; }, [pxPerSec]);
  const anchor = useRef<{ t: Ms; cursorX: number } | null>(null);

  // Mouse zoom, scoped to the timeline: ⌘/Ctrl + wheel (a trackpad pinch arrives as a ctrlKey wheel)
  // zooms around the cursor; a plain wheel scrolls sideways; ⇧ + wheel scrolls the tracks. All of
  // it calls preventDefault so the browser never page-zooms or scrolls the app. A native
  // non-passive listener, because React's onWheel cannot prevent the default.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
      if (e.ctrlKey || e.metaKey) {
        const cursorX = e.clientX - el.getBoundingClientRect().left;
        const z = zoomRef.current;
        const t = ((el.scrollLeft + cursorX - LABEL_W) / z) * 1000;
        const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * Math.exp(-e.deltaY * unit * 0.0035)));
        if (next === z) return;
        anchor.current = { t, cursorX };
        onZoom(next);
      } else if (e.shiftKey) {
        el.scrollTop += (e.deltaY || e.deltaX) * unit;
      } else {
        el.scrollLeft += (e.deltaX || e.deltaY) * unit;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onZoom]);
  // After a zoom, keep the time that was under the cursor under the cursor.
  useLayoutEffect(() => {
    const a = anchor.current, el = scrollRef.current;
    if (!a || !el) return;
    anchor.current = null;
    el.scrollLeft = (a.t / 1000) * pxPerSec + LABEL_W - a.cursorX;
  }, [pxPerSec]);
  const [drag, setDrag] = useState<{ kind: string } | null>(null);
  const widthPx = Math.max(600, (durationMs / 1000) * pxPerSec + 200);
  const xOf = (ms: Ms) => (ms / 1000) * pxPerSec;
  const msOf = (px: number) => (px / pxPerSec) * 1000;
  const snapMs = msOf(SNAP_PX);

  const main = mainTrack(doc);
  const overlay = overlayTrack(doc);
  const captions = captionTrack(doc);
  const texts = textTrack(doc);

  // Scrubbing on the ruler (and on empty track space). Snaps the playhead to edges when on.
  const scrubFrom = useCallback((e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const candidates = snap ? snapCandidates(doc, new Set(), -1).filter((t) => t >= 0) : [];
    const toT = (clientX: number) => {
      const raw = msOf(clientX - el.getBoundingClientRect().left + el.scrollLeft - LABEL_W);
      return snap ? snapTime(raw, candidates, snapMs) : raw;
    };
    onSeek(toT(e.clientX));
    const move = (ev: PointerEvent) => onSeek(toT(ev.clientX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSeek, pxPerSec, snap, doc]);

  /** Generic drag: `apply(base, deltaMs)` returns the previewed document. `edges` are the times of
   *  the moving edge(s) before the drag; with snap on, the delta is adjusted so the nearest one
   *  lands on a candidate. `exclude` are the ids being dragged (never snap to yourself). */
  const startDrag = (e: React.PointerEvent, kind: string, opts: { edges: Ms[]; exclude: string[] }, apply: (base: EditDocument, deltaMs: Ms, deltaPx: number) => EditDocument, onEnd?: (base: EditDocument, deltaMs: Ms) => EditDocument) => {
    e.stopPropagation();
    e.preventDefault();
    const base = doc;
    const x0 = e.clientX;
    let last = base;
    const candidates = snap ? snapCandidates(base, new Set(opts.exclude), tMs) : [];
    const delta = (dx: number) => { const raw = msOf(dx); return snap ? snapDelta(opts.edges, raw, candidates, snapMs) : raw; };
    setDrag({ kind });
    const move = (ev: PointerEvent) => { const dx = ev.clientX - x0; last = apply(base, delta(dx), dx); onChange(last, false); };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const dx = ev.clientX - x0;
      const final = onEnd ? onEnd(base, delta(dx)) : last;
      onChange(final, true);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ticks: number[] = [];
  const step = pxPerSec >= 120 ? 500 : pxPerSec >= 50 ? 1000 : pxPerSec >= 20 ? 2000 : 5000;
  for (let t = 0; t <= msOf(widthPx); t += step) ticks.push(t);

  const isSel = (kind: string, id: string) => !!selection && selection.kind === kind && "id" in selection && selection.id === id;

  const rowStyle = { height: ROW_H };
  const label = (text: string, hint?: string, h: number = ROW_H) => (
    <div className="sticky left-0 z-20 bg-rail flex items-center gap-2 px-3 text-[11px] text-ink-2 shrink-0" style={{ width: LABEL_W, height: h }}>
      <span className="truncate">{text}</span>{hint && <span className="text-[10px] text-faint truncate">{hint}</span>}
    </div>
  );
  const emptyScrub = (e: React.PointerEvent) => { if (e.target === e.currentTarget) scrubFrom(e); };

  return (
    <div ref={scrollRef} className="relative h-full overflow-auto overscroll-contain bg-surface select-none" style={{ touchAction: "none" }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
      <div style={{ width: LABEL_W + widthPx }} className="relative">
        {/* Ruler: pinned to the top while the tracks scroll under it */}
        <div className="sticky top-0 z-30 flex h-5 bg-surface">
          <div className="sticky left-0 z-20 bg-rail shrink-0 flex items-center px-3 text-[10px] font-mono text-ink-2" style={{ width: LABEL_W }}>{fmtTime(tMs)}</div>
          <div className="relative flex-1 cursor-col-resize" onPointerDown={scrubFrom}>
            {ticks.map((t) => (
              <div key={t} className="absolute bottom-0 h-1.5 border-l border-line-hard" style={{ left: xOf(t) }}>
                {t % 1000 === 0 && <span className="absolute bottom-1.5 left-1 text-[10px] font-mono text-faint">{fmtTime(t).replace(/\.\d+$/, "")}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Text track */}
        <div className="flex" style={{ height: ROW_TEXT }}>
          {label("Text", undefined, ROW_TEXT)}
          <div className="relative flex-1 bg-track-row border-b border-surface" onPointerDown={emptyScrub}>
            {texts?.kind === "text" && texts.elements.map((el) => (
              <div key={el.id}
                className={`absolute top-0.5 bottom-0.5 rounded-[2px] px-0.5 text-[11px] truncate flex items-center gap-1 cursor-grab bg-track-text text-ink-strong border ${isSel("text", el.id) ? "border-ink-strong ring-1 ring-ink-strong" : "border-transparent"}`}
                style={{ left: xOf(el.startMs), width: Math.max(8, xOf(el.endMs - el.startMs)) }}
                onPointerDownCapture={(e) => { if (e.button !== 0 || onHandle(e)) return; onSelect({ kind: "text", id: el.id }); startDrag(e, "text-move", { edges: [el.startMs, el.endMs], exclude: [el.id] }, (b, d) => updateText(b, el.id, { startMs: Math.max(0, el.startMs + d), endMs: Math.max(100, el.endMs + d) })); }}>
                <Handle side="l" onPointerDown={(e) => startDrag(e, "text-l", { edges: [el.startMs], exclude: [el.id] }, (b, d) => updateText(b, el.id, { startMs: Math.min(el.endMs - 100, Math.max(0, el.startMs + d)) }))} />
                <span className="truncate rounded-[2px] bg-track-text-2 px-1 leading-4">{el.text || "Text"}</span>
                <Handle side="r" onPointerDown={(e) => startDrag(e, "text-r", { edges: [el.endMs], exclude: [el.id] }, (b, d) => updateText(b, el.id, { endMs: Math.max(el.startMs + 100, el.endMs + d) }))} />
              </div>
            ))}
          </div>
        </div>

        {/* Caption track */}
        <div className="flex" style={rowStyle}>
          {label("Captions")}
          <div className="relative flex-1 bg-track-row border-b border-surface" onPointerDown={emptyScrub}>
            {captions?.kind === "caption" && captions.cues.map((q) => (
              <div key={q.id}
                className={`absolute top-1 bottom-1 rounded-[2px] px-0.5 text-[11px] truncate flex items-center gap-1 cursor-grab bg-track-caption text-ink-strong border ${isSel("cue", q.id) ? "border-ink-strong ring-1 ring-ink-strong" : "border-transparent"}`}
                style={{ left: xOf(q.startMs), width: Math.max(6, xOf(q.endMs - q.startMs)) }}
                onPointerDownCapture={(e) => { if (e.button !== 0 || onHandle(e)) return; onSelect({ kind: "cue", id: q.id }); startDrag(e, "cue-move", { edges: [q.startMs, q.endMs], exclude: [q.id] }, (b, d) => updateCue(b, q.id, { startMs: Math.max(0, q.startMs + d), endMs: Math.max(100, q.endMs + d), words: q.words ? q.words.map((w) => ({ ...w, startMs: w.startMs + d, endMs: w.endMs + d })) : null })); }}>
                <Handle side="l" onPointerDown={(e) => startDrag(e, "cue-l", { edges: [q.startMs], exclude: [q.id] }, (b, d) => updateCue(b, q.id, { startMs: Math.min(q.endMs - 100, Math.max(0, q.startMs + d)) }))} />
                <span className="truncate rounded-[2px] bg-track-caption-2 px-1 leading-4">{q.lines.join(" / ")}</span>
                <Handle side="r" onPointerDown={(e) => startDrag(e, "cue-r", { edges: [q.endMs], exclude: [q.id] }, (b, d) => updateCue(b, q.id, { endMs: Math.max(q.startMs + 100, q.endMs + d) }))} />
              </div>
            ))}
          </div>
        </div>

        {/* B-roll (overlay) track */}
        {overlay && (
          <div className="flex" style={{ height: ROW_OVERLAY }}>
            {label("B-roll", "over main", ROW_OVERLAY)}
            <div className="relative flex-1 bg-track-row border-b border-surface" onPointerDown={emptyScrub}>
              {overlay.clips.map((c) => {
                const len = clipLengthMs(c);
                return (
                  <div key={c.id}
                    className={`absolute top-1 bottom-1 rounded-[2px] px-0.5 text-[11px] truncate flex items-center gap-1 cursor-grab bg-track-video text-ink border ${isSel("clip", c.id) ? "border-ink-strong ring-1 ring-ink-strong" : "border-transparent"}`}
                    style={{ left: xOf(c.at), width: Math.max(8, xOf(len)) }}
                    onPointerDownCapture={(e) => { if (e.button !== 0 || onHandle(e)) return; onSelect({ kind: "clip", trackId: overlay.id, id: c.id }); startDrag(e, "ov-move", { edges: [c.at, c.at + len], exclude: [c.id] }, (b, d) => setClipAt(b, overlay.id, c.id, c.at + d)); }}>
                    <Handle side="l" onPointerDown={(e) => startDrag(e, "ov-l", { edges: [c.at], exclude: [c.id] }, (b, d) => trimClip(b, overlay.id, c.id, "start", d))} />
                    <span className="truncate rounded-[2px] bg-track-video-2 px-1 leading-4">{doc.assets.find((a) => a.id === c.assetId)?.name ?? "clip"}</span>
                    <Handle side="r" onPointerDown={(e) => startDrag(e, "ov-r", { edges: [c.at + len], exclude: [c.id] }, (b, d) => trimClip(b, overlay.id, c.id, "end", d))} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Main track */}
        <div className="flex" style={{ height: ROW_MAIN }}>
          {label("Video", "main", ROW_MAIN)}
          <div className="relative flex-1 bg-track-row" onPointerDown={emptyScrub}>
            {main.clips.map((c, i) => {
              const len = clipLengthMs(c);
              const asset = doc.assets.find((a) => a.id === c.assetId);
              const st = assetStatus[c.assetId];
              const failed = st?.state === "failed";
              const pending = !failed && len === 0;
              // A clip with no length yet (metadata pending or failed) still gets a readable block, so
              // it can be selected, retried or deleted instead of being a 10 px sliver.
              const width = len === 0 ? 140 : Math.max(10, xOf(len));
              const tone = failed ? "bg-danger-50 text-danger-700 border-danger-200" : "bg-track-video text-ink border-track-video";
              const selTone = failed ? "border-danger-500 ring-2 ring-danger-500/40" : "border-ink-strong ring-1 ring-ink-strong";
              const clipX = xOf(c.at);
              return (
                <div key={c.id} title={failed ? `${asset?.name}: ${st.reason}` : undefined}
                  className={`absolute top-0.5 bottom-0.5 rounded-[2px] text-[11px] flex flex-col overflow-hidden cursor-grab border ${tone} ${isSel("clip", c.id) ? selTone : ""} ${drag?.kind === "main-move" ? "transition-none" : ""}`}
                  style={{ left: xOf(c.at), width }}
                  onPointerDownCapture={(e) => {
                    if (e.button !== 0 || onHandle(e)) return;
                    onSelect({ kind: "clip", trackId: main.id, id: c.id });
                    // Reorder: the drop index is where the pointer's timeline position falls among the other clips' midpoints.
                    startDrag(e, "main-move", { edges: [], exclude: [c.id] }, (b) => b, (b, d) => {
                      const target = c.at + len / 2 + d;
                      const others = mainTrack(b).clips.filter((x) => x.id !== c.id);
                      let to = others.length;
                      for (let k = 0; k < others.length; k++) { if (target < others[k].at + clipLengthMs(others[k]) / 2) { to = k; break; } }
                      return to === i ? b : moveClip(b, main.id, c.id, to);
                    });
                  }}>
                  <Handle side="l" onPointerDown={(e) => startDrag(e, "main-l", { edges: [c.at], exclude: [c.id] }, (b, d) => trimClip(b, main.id, c.id, "start", d))} />
                  <div className="shrink-0 flex items-center gap-1 px-0.5 text-[10px] leading-none" style={{ height: STRIP_H }}>
                    <span className={`truncate rounded-[2px] px-1 py-[2px] ${failed ? "" : "bg-track-video-2"}`}>{asset?.name ?? "clip"}</span>
                    <span className={`font-mono shrink-0 rounded-[2px] px-1 py-[2px] ${failed ? "text-danger-600" : "bg-track-video-2"}`}>{failed ? `failed · ${st.reason}` : pending ? "reading length…" : fmtTime(len)}</span>
                  </div>
                  <div className="relative flex-1">
                    {!failed && !pending && asset && (
                      <ClipBody projectId={projectId} assetId={asset.id} url={asset.url} inMs={c.inMs} speed={c.speed} pxPerSec={pxPerSec} widthPx={width} view={{ from: view.from - clipX, to: view.to - clipX }} version={filmVersion} />
                    )}
                  </div>
                  <Handle side="r" onPointerDown={(e) => startDrag(e, "main-r", { edges: [c.at + len], exclude: [c.id] }, (b, d) => trimClip(b, main.id, c.id, "end", d))} />
                </div>
              );
            })}
            {/* Boundaries: a badge at each cut between main clips; with a transition, a band over the overlap */}
            {main.clips.slice(0, -1).map((c, i) => {
              const next = main.clips[i + 1];
              const tr = transitionAfter(main, c.id);
              const selected = selection?.kind === "transition" && selection.afterClipId === c.id;
              const x = tr ? xOf(next.at) : xOf(c.at + clipLengthMs(c));
              const w = tr ? Math.max(12, xOf(tr.durationMs)) : 0;
              return (
                <div key={`b-${c.id}`} className="absolute top-0 bottom-0 z-[5]" style={{ left: x, width: Math.max(w, 1) }}>
                  {tr && <div className={`absolute inset-y-1.5 inset-x-0 rounded-md ${selected ? "bg-accent/40" : "bg-accent/25"}`} />}
                  <button onPointerDownCapture={(e) => { e.stopPropagation(); if (e.button === 0) onSelect({ kind: "transition", afterClipId: c.id }); }}
                    title={tr ? `${TRANSITION_LABELS[tr.type]} · ${tr.durationMs} ms` : "Cut — click to add a transition"}
                    className={`absolute top-1/2 -translate-y-1/2 h-5 min-w-5 px-1 rounded-[3px] text-[10px] font-semibold flex items-center justify-center border ${selected ? "bg-accent text-on-accent border-accent" : tr ? "bg-surface-3 text-accent border-accent" : "bg-surface-3 text-muted border-transparent hover:text-ink"}`}
                    style={{ left: tr ? "50%" : 0, transform: tr ? "translate(-50%, -50%)" : "translate(-50%, -50%)" }}>
                    {tr ? "⇄" : "|"}
                  </button>
                </div>
              );
            })}
            {main.clips.length === 0 && <div className="absolute inset-0 flex items-center px-3 text-xs text-faint">No clips. Raw clips uploaded to the draft appear here.</div>}
          </div>
        </div>

        {/* Playhead: spans the whole scrolled content; its flag stays pinned to the ruler */}
        <div className="absolute top-0 bottom-0 w-px bg-ink-strong pointer-events-none z-40" style={{ left: LABEL_W + xOf(tMs) }}>
          <div className="sticky top-0 w-[9px] h-2.5 bg-ink-strong" style={{ clipPath: "polygon(0 0,100% 0,50% 100%)", marginLeft: -4 }} />
        </div>
      </div>
    </div>
  );
}

const onHandle = (e: React.PointerEvent) => !!(e.target as HTMLElement).closest?.("[data-handle]");

/** The body of a main-track clip: a filmstrip of frames sampled from the source (one per 31 px
 *  cell, on a 0.5 s grid shared across zoom levels) and a waveform in the bottom 14 px. One
 *  canvas covering just the visible slice of the clip; repainted when the slice, the zoom or the
 *  filmstrip store changes. Colours are the track tokens, read at paint time. */
function ClipBody({ projectId, assetId, url, inMs, speed, pxPerSec, widthPx, view, version }: { projectId: number; assetId: string; url: string; inMs: Ms; speed: number; pxPerSec: number; widthPx: number; view: { from: number; to: number }; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const from = Math.max(0, Math.floor(view.from)), to = Math.min(widthPx, Math.ceil(view.to));
  const w = Math.max(0, to - from);
  useEffect(() => {
    const c = ref.current;
    if (!c || w === 0) return;
    const h = c.clientHeight;
    if (h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(c);
    const tok = (n: string) => cs.getPropertyValue(n).trim();
    const fill = tok("--color-track-video"), cell = tok("--color-track-video-2"), wave = tok("--color-track-wave");
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
    const thumbH = Math.max(8, h - WAVE_H);
    const srcSec = (x: number) => inMs / 1000 + (x / pxPerSec) * speed;
    // Filmstrip: a cell per THUMB_W px, its frame the source time at the cell's left edge.
    const first = Math.floor(from / THUMB_W), last = Math.floor(Math.max(from, to - 1) / THUMB_W);
    const times: number[] = [];
    for (let i = first; i <= last; i++) {
      const x = i * THUMB_W, t = srcSec(x);
      times.push(t);
      const bmp = filmstrip.get(assetId, t);
      if (bmp) {
        const sh = Math.min(THUMB_H, thumbH);
        ctx.drawImage(bmp, 0, (THUMB_H - sh) / 2, THUMB_W, sh, x - from, 0, THUMB_W, thumbH);
      } else {
        ctx.fillStyle = cell;
        ctx.fillRect(x - from + 1, 1, THUMB_W - 2, thumbH - 2);
      }
    }
    if (times.length) filmstrip.request(assetId, url, times);
    // Waveform: for each pixel column, the loudest 20 ms window it covers, drawn about the band's middle.
    const pk = filmstrip.peaksFor(projectId, assetId);
    if (pk) {
      ctx.fillStyle = wave;
      const mid = thumbH + WAVE_H / 2, maxBar = WAVE_H - 2;
      for (let x = 0; x < w; x++) {
        const t0 = srcSec(from + x), t1 = srcSec(from + x + 1);
        const i0 = Math.max(0, Math.floor(t0 * pk.rate)), i1 = Math.max(i0 + 1, Math.ceil(t1 * pk.rate));
        let m = 0;
        for (let i = i0; i < i1 && i < pk.peaks.length; i++) if (pk.peaks[i] > m) m = pk.peaks[i];
        const bh = Math.max(1, (m / 255) * maxBar);
        ctx.fillRect(x, mid - bh / 2, 1, bh);
      }
    }
  }, [projectId, assetId, url, inMs, speed, pxPerSec, from, to, w, version]);
  if (w === 0) return null;
  return <canvas ref={ref} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: from, width: w }} />;
}

function Handle({ side, onPointerDown }: { side: "l" | "r"; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div data-handle onPointerDownCapture={(e) => { e.stopPropagation(); if (e.button === 0) onPointerDown(e); }}
      className={`absolute top-0 bottom-0 w-2 cursor-ew-resize hover:bg-shade/15 ${side === "l" ? "left-0 rounded-l-md" : "right-0 rounded-r-md"}`} />
  );
}
