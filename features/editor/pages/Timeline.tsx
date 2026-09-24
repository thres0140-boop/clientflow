"use client";

// The timeline: ruler, playhead and four tracks (text, captions, b-roll, main). All edits are
// pointer drags that preview live through onChange(doc, false) and commit on release with
// onChange(doc, true), so the undo stack gets one entry per gesture.
import { useCallback, useRef, useState } from "react";
import type { EditDocument, Ms } from "@/features/editor/model/document";
import { captionTrack, clipLengthMs, mainTrack, moveClip, overlayTrack, setClipAt, textTrack, trimClip, updateCue, updateText } from "@/features/editor/model/timeline";

export type Selection =
  | { kind: "clip"; trackId: string; id: string }
  | { kind: "cue"; id: string }
  | { kind: "text"; id: string }
  | null;

type Props = {
  doc: EditDocument;
  tMs: Ms;
  durationMs: Ms;
  pxPerSec: number;
  selection: Selection;
  onSeek: (t: Ms) => void;
  onSelect: (s: Selection) => void;
  onChange: (doc: EditDocument, commit: boolean) => void;
};

const LABEL_W = 88;
const ROW_H = 52;

export function fmtTime(ms: Ms): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
}

export default function Timeline({ doc, tMs, durationMs, pxPerSec, selection, onSeek, onSelect, onChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ kind: string; ghostAt?: number } | null>(null);
  const widthPx = Math.max(600, (durationMs / 1000) * pxPerSec + 200);
  const xOf = (ms: Ms) => (ms / 1000) * pxPerSec;
  const msOf = (px: number) => (px / pxPerSec) * 1000;

  const main = mainTrack(doc);
  const overlay = overlayTrack(doc);
  const captions = captionTrack(doc);
  const texts = textTrack(doc);

  // Scrubbing on the ruler (and on empty track space).
  const scrubFrom = useCallback((e: React.PointerEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    const toT = (clientX: number) => msOf(clientX - el.getBoundingClientRect().left + el.scrollLeft - LABEL_W);
    onSeek(toT(e.clientX));
    const move = (ev: PointerEvent) => onSeek(toT(ev.clientX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSeek, pxPerSec]);

  /** Generic drag: `apply(base, deltaMs)` returns the previewed document. */
  const startDrag = (e: React.PointerEvent, kind: string, apply: (base: EditDocument, deltaMs: Ms, deltaPx: number) => EditDocument, onEnd?: (base: EditDocument, deltaMs: Ms) => EditDocument) => {
    e.stopPropagation();
    e.preventDefault();
    const base = doc;
    const x0 = e.clientX;
    let last = base;
    setDrag({ kind });
    const move = (ev: PointerEvent) => { const dx = ev.clientX - x0; last = apply(base, msOf(dx), dx); onChange(last, false); };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      const dx = ev.clientX - x0;
      const final = onEnd ? onEnd(base, msOf(dx)) : last;
      onChange(final, true);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const ticks: number[] = [];
  const step = pxPerSec >= 120 ? 500 : pxPerSec >= 50 ? 1000 : pxPerSec >= 20 ? 2000 : 5000;
  for (let t = 0; t <= msOf(widthPx); t += step) ticks.push(t);

  const sel = (s: Selection) => (e: React.PointerEvent) => { e.stopPropagation(); onSelect(s); };
  const isSel = (kind: string, id: string) => !!selection && selection.kind === kind && selection.id === id;

  const rowStyle = { height: ROW_H };
  const label = (text: string, hint?: string) => (
    <div className="sticky left-0 z-20 bg-surface border-r border-line-hard flex flex-col justify-center px-3 text-[11px] font-semibold text-muted uppercase tracking-wide shrink-0" style={{ width: LABEL_W, ...rowStyle }}>
      {text}{hint && <span className="text-[10px] font-normal normal-case tracking-normal text-faint">{hint}</span>}
    </div>
  );

  return (
    <div ref={scrollRef} className="relative overflow-x-auto overflow-y-hidden bg-surface-2 border-t border-line select-none" style={{ touchAction: "none" }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
      <div style={{ width: LABEL_W + widthPx }} className="relative">
        {/* Ruler */}
        <div className="flex h-7 border-b border-line-hard bg-surface">
          <div className="sticky left-0 z-20 bg-surface border-r border-line-hard shrink-0 flex items-center px-3 text-[11px] font-mono text-ink-2" style={{ width: LABEL_W }}>{fmtTime(tMs)}</div>
          <div className="relative flex-1 cursor-col-resize" onPointerDown={scrubFrom}>
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 h-full border-l border-line-hard" style={{ left: xOf(t) }}>
                {t % 1000 === 0 && <span className="absolute top-1 left-1 text-[10px] font-mono text-faint">{fmtTime(t).replace(/\.\d+$/, "")}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Text track */}
        <div className="flex border-b border-line-soft" style={rowStyle} onPointerDown={(e) => { if (e.target === e.currentTarget) { onSelect(null); } }}>
          {label("Text")}
          <div className="relative flex-1" onPointerDown={(e) => { if (e.target === e.currentTarget) scrubFrom(e); }}>
            {texts?.kind === "text" && texts.elements.map((el) => (
              <div key={el.id} onPointerDown={sel({ kind: "text", id: el.id })}
                className={`absolute top-2 bottom-2 rounded-md px-2 text-[11px] truncate flex items-center cursor-grab bg-hue-violet-50 text-hue-violet-700 border ${isSel("text", el.id) ? "border-hue-violet-500 ring-2 ring-hue-violet-400/40" : "border-hue-violet-200"}`}
                style={{ left: xOf(el.startMs), width: Math.max(8, xOf(el.endMs - el.startMs)) }}
                onPointerDownCapture={(e) => { if (e.button !== 0 || onHandle(e)) return; onSelect({ kind: "text", id: el.id }); startDrag(e, "text-move", (b, d) => updateText(b, el.id, { startMs: Math.max(0, el.startMs + d), endMs: Math.max(100, el.endMs + d) })); }}>
                <Handle side="l" onPointerDown={(e) => startDrag(e, "text-l", (b, d) => updateText(b, el.id, { startMs: Math.min(el.endMs - 100, Math.max(0, el.startMs + d)) }))} />
                <span className="truncate">{el.text || "Text"}</span>
                <Handle side="r" onPointerDown={(e) => startDrag(e, "text-r", (b, d) => updateText(b, el.id, { endMs: Math.max(el.startMs + 100, el.endMs + d) }))} />
              </div>
            ))}
          </div>
        </div>

        {/* Caption track */}
        <div className="flex border-b border-line-soft" style={rowStyle}>
          {label("Captions")}
          <div className="relative flex-1" onPointerDown={(e) => { if (e.target === e.currentTarget) scrubFrom(e); }}>
            {captions?.kind === "caption" && captions.cues.map((q) => (
              <div key={q.id}
                className={`absolute top-2 bottom-2 rounded-md px-1.5 text-[11px] truncate flex items-center cursor-grab bg-warn-50 text-warn-700 border ${isSel("cue", q.id) ? "border-warn-500 ring-2 ring-warn-400/40" : "border-warn-200"}`}
                style={{ left: xOf(q.startMs), width: Math.max(6, xOf(q.endMs - q.startMs)) }}
                onPointerDownCapture={(e) => { if (e.button !== 0 || onHandle(e)) return; onSelect({ kind: "cue", id: q.id }); startDrag(e, "cue-move", (b, d) => updateCue(b, q.id, { startMs: Math.max(0, q.startMs + d), endMs: Math.max(100, q.endMs + d), words: q.words ? q.words.map((w) => ({ ...w, startMs: w.startMs + d, endMs: w.endMs + d })) : null })); }}>
                <Handle side="l" onPointerDown={(e) => startDrag(e, "cue-l", (b, d) => updateCue(b, q.id, { startMs: Math.min(q.endMs - 100, Math.max(0, q.startMs + d)) }))} />
                <span className="truncate">{q.lines.join(" / ")}</span>
                <Handle side="r" onPointerDown={(e) => startDrag(e, "cue-r", (b, d) => updateCue(b, q.id, { endMs: Math.max(q.startMs + 100, q.endMs + d) }))} />
              </div>
            ))}
          </div>
        </div>

        {/* B-roll (overlay) track */}
        {overlay && (
          <div className="flex border-b border-line-soft" style={rowStyle}>
            {label("B-roll", "over main")}
            <div className="relative flex-1" onPointerDown={(e) => { if (e.target === e.currentTarget) scrubFrom(e); }}>
              {overlay.clips.map((c) => (
                <div key={c.id}
                  className={`absolute top-1.5 bottom-1.5 rounded-md px-1.5 text-[11px] truncate flex items-center cursor-grab bg-hue-sky-50 text-hue-sky-700 border ${isSel("clip", c.id) ? "border-hue-sky-400 ring-2 ring-hue-sky-400/40" : "border-hue-sky-200"}`}
                  style={{ left: xOf(c.at), width: Math.max(8, xOf(clipLengthMs(c))) }}
                  onPointerDownCapture={(e) => { if (e.button !== 0 || onHandle(e)) return; onSelect({ kind: "clip", trackId: overlay.id, id: c.id }); startDrag(e, "ov-move", (b, d) => setClipAt(b, overlay.id, c.id, c.at + d)); }}>
                  <Handle side="l" onPointerDown={(e) => startDrag(e, "ov-l", (b, d) => trimClip(b, overlay.id, c.id, "start", d))} />
                  <span className="truncate">{doc.assets.find((a) => a.id === c.assetId)?.name ?? "clip"}</span>
                  <Handle side="r" onPointerDown={(e) => startDrag(e, "ov-r", (b, d) => trimClip(b, overlay.id, c.id, "end", d))} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Main track */}
        <div className="flex border-b border-line-soft" style={{ height: ROW_H + 12 }}>
          {label("Video", "main")}
          <div className="relative flex-1" onPointerDown={(e) => { if (e.target === e.currentTarget) scrubFrom(e); }}>
            {main.clips.map((c, i) => {
              const len = clipLengthMs(c);
              const asset = doc.assets.find((a) => a.id === c.assetId);
              return (
                <div key={c.id}
                  className={`absolute top-1.5 bottom-1.5 rounded-lg px-2 text-[11px] flex items-center overflow-hidden cursor-grab bg-hue-emerald-50 text-hue-emerald-700 border ${isSel("clip", c.id) ? "border-hue-emerald-500 ring-2 ring-hue-emerald-500/40" : "border-hue-emerald-200"} ${drag?.kind === "main-move" ? "transition-none" : ""}`}
                  style={{ left: xOf(c.at), width: Math.max(10, xOf(len)) }}
                  onPointerDownCapture={(e) => {
                    if (e.button !== 0 || onHandle(e)) return;
                    onSelect({ kind: "clip", trackId: main.id, id: c.id });
                    // Reorder: the drop index is where the pointer's timeline position falls among the other clips' midpoints.
                    startDrag(e, "main-move", (b) => b, (b, d) => {
                      const target = c.at + len / 2 + d;
                      const others = mainTrack(b).clips.filter((x) => x.id !== c.id);
                      let to = others.length;
                      for (let k = 0; k < others.length; k++) { if (target < others[k].at + clipLengthMs(others[k]) / 2) { to = k; break; } }
                      return to === i ? b : moveClip(b, main.id, c.id, to);
                    });
                  }}>
                  <Handle side="l" onPointerDown={(e) => startDrag(e, "main-l", (b, d) => trimClip(b, main.id, c.id, "start", d))} />
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{asset?.name ?? "clip"}</div>
                    <div className="text-[10px] text-hue-emerald-600 font-mono">{fmtTime(len)}{len === 0 ? " · loading" : ""}</div>
                  </div>
                  <Handle side="r" onPointerDown={(e) => startDrag(e, "main-r", (b, d) => trimClip(b, main.id, c.id, "end", d))} />
                </div>
              );
            })}
            {main.clips.length === 0 && <div className="absolute inset-0 flex items-center px-3 text-xs text-faint">No clips. Raw clips uploaded to the draft appear here.</div>}
          </div>
        </div>

        {/* Playhead */}
        <div className="absolute top-0 bottom-0 w-px bg-danger-500 pointer-events-none z-10" style={{ left: LABEL_W + xOf(tMs) }}>
          <div className="absolute -top-0 -left-[5px] w-[11px] h-3 bg-danger-500" style={{ clipPath: "polygon(0 0,100% 0,50% 100%)" }} />
        </div>
      </div>
    </div>
  );
}

const onHandle = (e: React.PointerEvent) => !!(e.target as HTMLElement).closest?.("[data-handle]");

function Handle({ side, onPointerDown }: { side: "l" | "r"; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div data-handle onPointerDownCapture={(e) => { e.stopPropagation(); if (e.button === 0) onPointerDown(e); }}
      className={`absolute top-0 bottom-0 w-2 cursor-ew-resize hover:bg-shade/15 ${side === "l" ? "left-0 rounded-l-md" : "right-0 rounded-r-md"}`} />
  );
}
