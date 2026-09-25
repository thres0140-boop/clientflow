"use client";

// The video editor for one ScriptDraft. Owns the document, the undo stack, autosave with the
// version rule (409 → show who saved, offer reload, never clobber), the preview canvas and the
// keyboard. The timeline and inspector are children; the playback engine is a hook.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CANVAS, type EditDocument, IDENTITY_TRANSFORM, type Ms } from "@/features/editor/model/document";
import { addAsset, addClip, addCue, addText, deleteClip, deleteCue, deleteText, mainTrack, overlayTrack, removeAsset, splitClipAt, updateClip, updateText } from "@/features/editor/model/timeline";
import { clipRect, textElementAt } from "@/features/editor/render/compositor";
import { loadAllCaptionFonts } from "@/features/editor/render/fonts";
import { readEmbedFlag } from "@/shared/embed";
import Timeline, { fmtTime, type Selection } from "./Timeline";
import Inspector from "./Inspector";
import BrollPicker from "./BrollPicker";
import { usePlayback } from "./usePlayback";

type ProjectView = { id: number; draftId: number; clientId: number; version: number; updatedBy: string | null; updatedAt: string; document: EditDocument };
type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

const AUTOSAVE_MS = 1500;
const HISTORY_CAP = 100;

export default function EditorPage({ draftId }: { draftId: number }) {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [doc, setDocState] = useState<EditDocument | null>(null);
  const versionRef = useRef(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState<ProjectView | null>(null);
  const dirtyRef = useRef(false);
  const history = useRef<{ past: EditDocument[]; future: EditDocument[] }>({ past: [], future: [] });
  const [histSize, setHistSize] = useState({ past: 0, future: 0 });
  const [selection, setSelection] = useState<Selection>(null);
  const [pxPerSec, setPxPerSec] = useState(60);
  const [picker, setPicker] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  const embedded = useMemo(() => readEmbedFlag(), []);

  // ── document + history ──────────────────────────────────────────────────────
  const docRef = useRef<EditDocument | null>(null);
  useEffect(() => { docRef.current = doc; }, [doc]);
  const markDirty = useCallback(() => { dirtyRef.current = true; setSaveState((s) => (s === "conflict" ? s : "dirty")); }, []);

  /** onChange(doc, commit): commit=true pushes an undo step (one per gesture); false previews. */
  const onChange = useCallback((next: EditDocument, commit: boolean) => {
    const prev = docRef.current;
    if (commit && prev && prev !== next) {
      const h = history.current;
      // The gesture's preview frames already replaced `doc`; the undo entry is the state BEFORE the gesture.
      h.past.push(gestureBase.current ?? prev);
      if (h.past.length > HISTORY_CAP) h.past.shift();
      h.future = [];
      setHistSize({ past: h.past.length, future: 0 });
    }
    if (!commit && !gestureBase.current && prev) gestureBase.current = prev;
    if (commit) gestureBase.current = null;
    setDocState(next);
    markDirty();
  }, [markDirty]);
  const gestureBase = useRef<EditDocument | null>(null);

  const setDocFromEngine = useCallback((f: (d: EditDocument) => EditDocument) => {
    setDocState((d) => (d ? f(d) : d));
    markDirty();
  }, [markDirty]);

  const undo = useCallback(() => {
    const h = history.current, cur = docRef.current;
    const prev = h.past.pop();
    if (!prev || !cur) return;
    h.future.push(cur);
    setHistSize({ past: h.past.length, future: h.future.length });
    setDocState(prev); markDirty();
  }, [markDirty]);
  const redo = useCallback(() => {
    const h = history.current, cur = docRef.current;
    const next = h.future.pop();
    if (!next || !cur) return;
    h.past.push(cur);
    setHistSize({ past: h.past.length, future: h.future.length });
    setDocState(next); markDirty();
  }, [markDirty]);

  // ── load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadAllCaptionFonts();
    (async () => {
      try {
        const r = await fetch(`/api/edit-projects?draftId=${draftId}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (cancelled) return;
        setProject(j.project);
        versionRef.current = j.project.version;
        setDocState(j.project.document);
        fetch(`/api/script-drafts/${draftId}`).then((x) => x.json()).then((d) => { if (!cancelled && d?.title) setDraftTitle(d.title); }).catch(() => {});
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [draftId]);

  // ── save ───────────────────────────────────────────────────────────────────
  const save = useCallback(async (overwriteVersion?: number) => {
    const p = project, d = docRef.current;
    if (!p || !d) return;
    dirtyRef.current = false;
    setSaveState("saving");
    try {
      const r = await fetch(`/api/edit-projects/${p.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document: d, version: overwriteVersion ?? versionRef.current }) });
      const j = await r.json();
      if (r.status === 409) { setConflict(j.project); setSaveState("conflict"); return; }
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      versionRef.current = j.project.version;
      setConflict(null);
      setSaveState(dirtyRef.current ? "dirty" : "saved");
    } catch {
      dirtyRef.current = true;
      setSaveState("error");
    }
  }, [project]);

  useEffect(() => {
    if (!doc || !project || !dirtyRef.current || saveState === "conflict" || saveState === "saving") return;
    const t = setTimeout(() => { if (dirtyRef.current) save(); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [doc, project, save, saveState]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  function reloadTheirs() {
    if (!conflict) return;
    versionRef.current = conflict.version;
    history.current = { past: [], future: [] };
    setHistSize({ past: 0, future: 0 });
    setDocState(conflict.document);
    dirtyRef.current = false;
    setConflict(null);
    setSaveState("saved");
  }
  function overwriteWithMine() {
    if (!conflict) return;
    dirtyRef.current = true;
    save(conflict.version);
  }

  // ── playback ───────────────────────────────────────────────────────────────
  const safeDoc = doc ?? EMPTY_DOC;
  const pb = usePlayback(safeDoc, canvasRef, setDocFromEngine);
  const frameMs = 1000 / (safeDoc.canvas.fps || 30);

  // ── actions ────────────────────────────────────────────────────────────────
  const commit = (next: EditDocument) => onChange(next, true);
  function splitAtPlayhead() {
    if (!doc) return;
    const trackId = selection?.kind === "clip" ? selection.trackId : mainTrack(doc).id;
    commit(splitClipAt(doc, trackId, pb.tMs));
  }
  function deleteSelected() {
    if (!doc || !selection) return;
    if (selection.kind === "clip") commit(deleteClip(doc, selection.trackId, selection.id));
    else if (selection.kind === "cue") commit(deleteCue(doc, selection.id));
    else commit(deleteText(doc, selection.id));
    setSelection(null);
  }
  function addCaptionHere() {
    if (!doc) return;
    commit(addCue(doc, { startMs: pb.tMs, endMs: pb.tMs + 1500, lines: ["Caption"], words: null }));
  }
  function addTextHere() {
    if (!doc) return;
    const r = addText(doc, { text: "Text", startMs: pb.tMs, endMs: pb.tMs + 2000, style: doc.captionStyle, transform: { ...IDENTITY_TRANSFORM, y: 0.4 } });
    commit(r.doc);
    setSelection({ kind: "text", id: r.id });
  }
  function addBroll(assetId: string) {
    if (!doc) return;
    const ov = overlayTrack(doc);
    if (!ov) return;
    commit(addClip(doc, ov.id, assetId, pb.tMs));
    setPicker(false);
  }
  function addBrollUpload(url: string, name: string) {
    if (!doc) return;
    const ov = overlayTrack(doc);
    if (!ov) return;
    const r = addAsset(doc, { url, name });
    commit(addClip(r.doc, ov.id, r.assetId, pb.tMs)); // 0-length until metadata loads, then it expands
    setPicker(false);
  }

  // Keyboard: space play, ←/→ frame step (shift = 1 s), S split, Delete, ⌘Z / ⌘⇧Z.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === " ") { e.preventDefault(); pb.toggle(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); pb.seek(pb.tMs - (e.shiftKey ? 1000 : frameMs)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); pb.seek(pb.tMs + (e.shiftKey ? 1000 : frameMs)); }
      else if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); splitAtPlayhead(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  // ── dragging text / b-roll on the preview ─────────────────────────────────
  function onPreviewPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current, d = docRef.current;
    if (!c || !d) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const rect = c.getBoundingClientRect();
    const toCanvas = (cx: number, cy: number) => ({ x: ((cx - rect.left) / rect.width) * d.canvas.width, y: ((cy - rect.top) / rect.height) * d.canvas.height });
    const p = toCanvas(e.clientX, e.clientY);
    const textId = textElementAt(ctx, d, pb.tMs, p.x, p.y);
    let target: { kind: "text"; id: string; x: number; y: number } | { kind: "clip"; trackId: string; id: string; x: number; y: number } | null = null;
    if (textId) {
      const el = d.tracks.flatMap((t) => (t.kind === "text" ? t.elements : [])).find((x) => x.id === textId)!;
      target = { kind: "text", id: textId, x: el.transform.x, y: el.transform.y };
      setSelection({ kind: "text", id: textId });
    } else {
      const ov = overlayTrack(d);
      const hit = ov?.clips.slice().reverse().find((cl) => {
        if (pb.tMs < cl.at || pb.tMs >= cl.at + (cl.outMs - cl.inMs)) return false;
        const a = d.assets.find((as) => as.id === cl.assetId);
        const r = clipRect(cl, { width: a?.width || d.canvas.width, height: a?.height || d.canvas.height }, d.canvas);
        return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
      });
      if (hit && ov) { target = { kind: "clip", trackId: ov.id, id: hit.id, x: hit.transform.x, y: hit.transform.y }; setSelection({ kind: "clip", trackId: ov.id, id: hit.id }); }
    }
    if (!target) return;
    e.preventDefault();
    const start = p;
    const base = d;
    let last = d;
    const move = (ev: PointerEvent) => {
      const q = toCanvas(ev.clientX, ev.clientY);
      const nx = target!.x + (q.x - start.x) / d.canvas.width, ny = target!.y + (q.y - start.y) / d.canvas.height;
      last = target!.kind === "text"
        ? updateText(base, target!.id, { transform: { ...base.tracks.flatMap((t) => (t.kind === "text" ? t.elements : [])).find((x) => x.id === target!.id)!.transform, x: nx, y: ny } })
        : updateClip(base, target!.trackId, target!.id, { transform: { ...overlayTrack(base)!.clips.find((x) => x.id === target!.id)!.transform, x: nx, y: ny } });
      onChange(last, false);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); onChange(last, true); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ── render ─────────────────────────────────────────────────────────────────
  if (loadError) {
    return <div className="h-screen flex items-center justify-center bg-canvas-2 text-sm text-danger-600">{loadError}</div>;
  }
  if (!doc || !project) {
    return <div className="h-screen flex items-center justify-center bg-canvas-2 text-sm text-muted">Loading editor…</div>;
  }
  const backHref = `/?page=kanban&clientId=${project.clientId}&draft=${draftId}${embedded ? "&embed=1" : ""}`;
  // Per-asset media state from the playback engine: a clip that never answers is marked failed
  // (with the reason) after a timeout; the rest of the editor keeps working with what did load.
  const loadingAssets = doc.assets.filter((a) => pb.status[a.id]?.state === "loading" || (!pb.status[a.id] && a.durationMs == null));
  const failedAssets = doc.assets.filter((a) => pb.status[a.id]?.state === "failed").map((a) => ({ asset: a, reason: (pb.status[a.id] as { reason: string }).reason }));

  return (
    <div className="h-screen flex flex-col bg-canvas-2 text-ink overflow-hidden">
      {/* Header */}
      <header className="h-12 shrink-0 flex items-center gap-3 px-3 bg-surface border-b border-line">
        <a href={backHref} className="text-xs font-semibold text-muted hover:text-ink">← Kanban</a>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold truncate">{draftTitle || `Draft #${draftId}`}</div>
        </div>
        <span className={`text-[11px] font-semibold ${saveState === "error" ? "text-danger-600" : saveState === "conflict" ? "text-warn-700" : "text-muted"}`}>
          {saveState === "saved" ? "Saved" : saveState === "dirty" ? "Unsaved changes" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed, retrying" : "Conflict"}
        </span>
        <button onClick={undo} disabled={!histSize.past} className="o-btn o-btn-ghost text-xs px-2 py-1.5 disabled:opacity-40" title="Undo (⌘Z)">↶</button>
        <button onClick={redo} disabled={!histSize.future} className="o-btn o-btn-ghost text-xs px-2 py-1.5 disabled:opacity-40" title="Redo (⌘⇧Z)">↷</button>
        <button className="o-btn o-btn-primary text-xs" disabled title="Export arrives in Phase 4">Export</button>
      </header>

      {/* Conflict banner */}
      {conflict && (
        <div className="shrink-0 flex items-center gap-3 px-3 py-2 bg-warn-50 border-b border-warn-200 text-xs text-warn-700">
          <span className="font-semibold">{conflict.updatedBy || "Someone"} saved this project at {new Date(conflict.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} while you were editing.</span>
          <span className="text-warn-600">Your changes are not saved. Reload their version (loses yours) or overwrite it with yours.</span>
          <span className="flex-1" />
          <button onClick={reloadTheirs} className="o-btn o-btn-primary text-xs">Reload their version</button>
          <button onClick={overwriteWithMine} className="o-btn o-btn-ghost text-xs">Overwrite with mine</button>
        </div>
      )}

      {/* Preview + inspector */}
      <div className="flex-1 min-h-0 flex">
        <div ref={previewBox} className="flex-1 min-w-0 flex flex-col items-center justify-center gap-2 p-3">
          <div className="relative h-full max-h-full" style={{ aspectRatio: `${doc.canvas.width} / ${doc.canvas.height}` }}>
            <canvas ref={canvasRef} width={doc.canvas.width} height={doc.canvas.height} onPointerDown={onPreviewPointerDown}
              className="h-full w-auto max-w-full rounded-xl bg-black shadow-lift touch-none" />
            {/* Overlays on the media: black/white chrome by design (dark-mode doc, media rule). */}
            <div className="absolute top-2 left-2 right-2 flex flex-col gap-1 pointer-events-none">
              {loadingAssets.length > 0 && <div className="self-start text-[10px] font-semibold text-white/80 bg-black/50 rounded px-1.5 py-0.5">Reading {loadingAssets.length} clip length{loadingAssets.length === 1 ? "" : "s"}…</div>}
              {failedAssets.map(({ asset, reason }) => (
                <div key={asset.id} className="pointer-events-auto flex items-center gap-2 text-[10px] text-white bg-black/70 rounded px-2 py-1">
                  <span className="min-w-0 flex-1 truncate"><span className="font-semibold">{asset.name}</span> failed: {reason}</span>
                  <button onClick={() => pb.retryAsset(asset.id)} className="font-semibold underline shrink-0">Retry</button>
                  <button onClick={() => { commit(removeAsset(doc, asset.id)); setSelection(null); }} className="font-semibold underline shrink-0">Remove</button>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => pb.seek(pb.tMs - frameMs)} className="o-btn o-btn-ghost text-xs px-2 py-1.5" title="Previous frame (←)">⏮</button>
            <button onClick={pb.toggle} className="o-btn o-btn-accent text-xs w-20">{pb.playing ? "Pause" : "Play"}</button>
            <button onClick={() => pb.seek(pb.tMs + frameMs)} className="o-btn o-btn-ghost text-xs px-2 py-1.5" title="Next frame (→)">⏭</button>
            <span className="text-xs font-mono text-ink-2 w-28 text-center">{fmtTime(pb.tMs)} / {fmtTime(pb.durationMs)}</span>
          </div>
        </div>
        <aside className="w-80 shrink-0 bg-surface border-l border-line overflow-y-auto p-3">
          <Inspector doc={doc} selection={selection} clientId={project.clientId} onChange={onChange} onSelect={setSelection} />
        </aside>
      </div>

      {/* Toolbar + timeline */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-surface border-t border-line text-xs">
        <button onClick={splitAtPlayhead} className="o-btn o-btn-ghost text-xs px-2 py-1.5" title="Split at playhead (S)">✂ Split</button>
        <button onClick={deleteSelected} disabled={!selection} className="o-btn o-btn-ghost text-xs px-2 py-1.5 disabled:opacity-40" title="Delete selection (⌫)">Delete</button>
        <span className="w-px h-5 bg-line-hard mx-1" />
        <button onClick={addCaptionHere} className="o-btn o-btn-ghost text-xs px-2 py-1.5">+ Caption</button>
        <button onClick={addTextHere} className="o-btn o-btn-ghost text-xs px-2 py-1.5">+ Text</button>
        <button onClick={() => setPicker(true)} className="o-btn o-btn-ghost text-xs px-2 py-1.5">+ B-roll</button>
        <span className="flex-1" />
        <span className="text-faint">Zoom</span>
        <button onClick={() => setPxPerSec((z) => Math.max(10, z / 1.5))} className="o-btn o-btn-ghost text-xs px-2 py-1.5">−</button>
        <button onClick={() => setPxPerSec((z) => Math.min(400, z * 1.5))} className="o-btn o-btn-ghost text-xs px-2 py-1.5">+</button>
      </div>
      <div className="shrink-0 h-[248px] overflow-hidden">
        <Timeline doc={doc} tMs={pb.tMs} durationMs={pb.durationMs} pxPerSec={pxPerSec} selection={selection} assetStatus={pb.status} onSeek={pb.seek} onSelect={setSelection} onChange={onChange} />
      </div>

      {picker && <BrollPicker doc={doc} onPick={addBroll} onUploaded={addBrollUpload} onClose={() => setPicker(false)} />}
    </div>
  );
}

const EMPTY_DOC: EditDocument = { v: 1, canvas: { ...DEFAULT_CANVAS }, assets: [], tracks: [{ id: "main", kind: "video", role: "main", clips: [] }], captionStyle: { v: 1, font: { family: "Roboto", weight: 700, sizePx: 72, letterSpacingPx: 0, italic: false, uppercase: true }, fill: { color: "#ffffff" }, outline: { color: "#000000", widthPx: 5 }, shadow: { color: "#000000", offsetPx: 2, opacity: 0.5 }, box: { enabled: false, color: "#000000", opacity: 0.6, paddingPx: 16 }, layout: { anchor: "bottom", align: "center", marginVPx: 420, marginHPx: 60, maxLines: 2, wordsPerCue: 2 }, highlight: { mode: "none", color: "#ffe34d" } }, transcript: null };

