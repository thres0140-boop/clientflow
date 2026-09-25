"use client";

// The video editor for one ScriptDraft. Owns the document, the undo stack, autosave with the
// version rule (409 → show who saved, offer reload, never clobber), the preview canvas and the
// keyboard. Five regions, CapCut-style: a tab bar across the top, the active tab's panel on the
// left, the preview with its controls in the centre, a contextual properties panel on the
// right, and the timeline with its own toolbar at the bottom. The playback engine is a hook.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CANVAS, type EditDocument, IDENTITY_TRANSFORM } from "@/features/editor/model/document";
import { addAsset, addClip, addCue, addText, clipAt, clipLengthMs, deleteClip, deleteCue, deleteText, mainTrack, overlayTrack, removeAsset, replaceCues, setAllTransitions, setCaptionStyle, setTranscript, setTransition, splitClipAt, trimClipToTime, updateClip, updateText } from "@/features/editor/model/timeline";
import { type ClientCaptionSettings, type NamedPreset } from "@/features/editor/model/captionPresets";
import { type CaptionStyle, DEFAULT_CAPTION_STYLE } from "@/features/editor/model/captionStyle";
import type { TransitionType } from "@/features/editor/model/document";
import type { PresetsApi } from "./PresetGrid";
import { layoutCaptions, timelineWords } from "@/features/editor/model/captions";
import { alignToScript } from "@/features/editor/model/align";
import type { AssetTranscript, Transcript } from "@/features/editor/model/document";
import type { AutoCaptions, AutoCaptionsState } from "./LeftPanel";
import { textElementAt } from "@/features/editor/render/compositor";
import { drawChrome, type Guides, hitHandle, insideBox, type Selected, selectionBox, snapCentre } from "@/features/editor/render/chrome";
import { loadAllCaptionFonts } from "@/features/editor/render/fonts";
import { readEmbedFlag } from "@/shared/embed";
import Timeline, { fmtTime, type Selection, ZOOM_MAX, ZOOM_MIN } from "./Timeline";
import Inspector from "./Inspector";
import LeftPanel, { type EditorTab, NOT_BUILT } from "./LeftPanel";
import { Icon, IconButton } from "./icons";
import { type OverlayChrome, usePlayback } from "./usePlayback";

type ProjectView = { id: number; draftId: number; clientId: number; version: number; updatedBy: string | null; updatedAt: string; document: EditDocument; clientCaptions?: ClientCaptionSettings };
type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

const AUTOSAVE_MS = 1500;
const HISTORY_CAP = 100;

// The divider between the upper area and the timeline: remembered per user like the other cf_* keys.
const TIMELINE_H_KEY = "cf_editor_timeline_h";
const SNAP_KEY = "cf_editor_snap";
const TIMELINE_H_DEFAULT = 292;
const TIMELINE_H_MIN = 160;          // toolbar + ruler + two rows
const UPPER_MIN = 260;               // the preview must keep a usable height
// Zoom bounds live in Timeline (ZOOM_MIN/ZOOM_MAX); the slider is logarithmic between them.
function readNumber(key: string, fallback: number): number {
  try { const v = Number(localStorage.getItem(key)); return Number.isFinite(v) && v > 0 ? v : fallback; } catch { return fallback; }
}
function readBool(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v === "1"; } catch { return fallback; }
}

export default function EditorPage({ draftId }: { draftId: number }) {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [scriptText, setScriptText] = useState<string | null>(null); // the draft's hook + script, the ground truth for alignment
  const [clientCaptions, setClientCaptions] = useState<ClientCaptionSettings>({ default: null, presets: [] });
  const [doc, setDocState] = useState<EditDocument | null>(null);
  const versionRef = useRef(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState<ProjectView | null>(null);
  const dirtyRef = useRef(false);
  const history = useRef<{ past: EditDocument[]; future: EditDocument[] }>({ past: [], future: [] });
  const [histSize, setHistSize] = useState({ past: 0, future: 0 });
  const [selection, setSelection] = useState<Selection>(null);
  const [pxPerSec, setPxPerSec] = useState(60);
  const [snap, setSnapState] = useState(() => readBool(SNAP_KEY, true));
  const setSnap = (v: boolean) => { setSnapState(v); try { localStorage.setItem(SNAP_KEY, v ? "1" : "0"); } catch { /* ignore */ } };
  const [timelineH, setTimelineH] = useState(() => readNumber(TIMELINE_H_KEY, TIMELINE_H_DEFAULT));
  const shellRef = useRef<HTMLDivElement>(null);
  const clampTimelineH = (h: number) => {
    const shell = shellRef.current;
    const max = shell ? Math.max(TIMELINE_H_MIN, shell.clientHeight - UPPER_MIN) : 800;
    return Math.round(Math.min(max, Math.max(TIMELINE_H_MIN, h)));
  };
  /** The draggable divider: pointer capture on the handle itself, so it never fights the
   *  timeline's own scroll or the drags on clips. Double-click resets. */
  function onDividerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY, startH = timelineH;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let last = startH;
    const move = (ev: PointerEvent) => { last = clampTimelineH(startH - (ev.clientY - startY)); setTimelineH(last); };
    const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); try { localStorage.setItem(TIMELINE_H_KEY, String(last)); } catch { /* ignore */ } };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }
  function resetDivider() { setTimelineH(TIMELINE_H_DEFAULT); try { localStorage.removeItem(TIMELINE_H_KEY); } catch { /* ignore */ } }
  // A window that gets shorter must not let a remembered height push the preview off screen.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTimelineH((h) => clampTimelineH(h)));
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const zoomToSlider = (z: number) => Math.round(((Math.log(z) - Math.log(ZOOM_MIN)) / (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN))) * 100);
  const sliderToZoom = (v: number) => Math.exp(Math.log(ZOOM_MIN) + (v / 100) * (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN)));
  const [tab, setTab] = useState<EditorTab>("media");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoLayerRef = useRef<HTMLDivElement>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  const previewArea = useRef<HTMLDivElement>(null);
  const docRef = useRef<EditDocument | null>(null);
  useEffect(() => { docRef.current = doc; }, [doc]);
  // The preview fills its panel: the canvas is sized to the largest rectangle of the document's
  // aspect that fits the measured area (never above the document's own pixel size).
  const [fit, setFit] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = previewArea.current;
    if (!el) return;
    const measure = () => {
      const d = docRef.current;
      if (!d) return;
      const pad = 12;
      const availW = Math.max(0, el.clientWidth - pad * 2), availH = Math.max(0, el.clientHeight - pad * 2);
      const ar = d.canvas.width / d.canvas.height;
      let h = Math.min(availH, d.canvas.height), w = h * ar;
      if (w > availW) { w = availW; h = w / ar; }
      setFit((f) => (Math.abs(f.w - w) < 1 && Math.abs(f.h - h) < 1 ? f : { w: Math.floor(w), h: Math.floor(h) }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  });
  const embedded = useMemo(() => readEmbedFlag(), []);

  // ── document + history ──────────────────────────────────────────────────────
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
        if (j.project.clientCaptions) setClientCaptions(j.project.clientCaptions);
        fetch(`/api/script-drafts/${draftId}`).then((x) => x.json()).then((d) => {
          if (cancelled) return;
          if (d?.title) setDraftTitle(d.title);
          const text = [d?.hook, d?.script].filter((s) => typeof s === "string" && s.trim()).join("\n");
          setScriptText(text || null);
        }).catch(() => {});
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
  // Selection chrome on the preview (box, handles, guides), painted after the captions by the engine.
  const guidesRef = useRef<Guides | null>(null);
  const draggingRef = useRef(false);
  const chromeRef = useRef<OverlayChrome | null>(null);
  const selectedEl: Selected | null = selection && (selection.kind === "clip" || selection.kind === "text") ? selection : null;
  const selectedRef = useRef<Selected | null>(null);
  useEffect(() => { selectedRef.current = selectedEl; }, [selectedEl]);
  const pb = usePlayback(safeDoc, canvasRef, setDocFromEngine, { mountRef: videoLayerRef, display: fit, chromeRef });
  const videoForRef = useRef(pb.videoFor);
  useEffect(() => { videoForRef.current = pb.videoFor; }, [pb.videoFor]);
  useEffect(() => {
    chromeRef.current = {
      key: () => `${selectedRef.current ? `${selectedRef.current.kind}:${selectedRef.current.id}` : "-"}|${draggingRef.current ? "d" : ""}|${guidesRef.current ? `${guidesRef.current.v.join(",")}/${guidesRef.current.h.join(",")}` : ""}`,
      draw: (ctx, d, t) => {
        const sb = selectionBox(d, selectedRef.current, t, (id) => { const v = videoForRef.current(id); return v && v.videoWidth ? { width: v.videoWidth, height: v.videoHeight } : null; });
        if (!sb && !guidesRef.current) return;
        const cs = canvasRef.current ? getComputedStyle(canvasRef.current) : null;
        const colours = { accent: cs?.getPropertyValue("--color-accent").trim() || "#2dd4bf", ink: cs?.getPropertyValue("--color-ink").trim() || "#e8e8e8" };
        drawChrome(ctx, d, sb?.box ?? null, guidesRef.current, colours, draggingRef.current);
      },
    };
  }, []);
  // A selection change must repaint the chrome even though the document did not change.
  useEffect(() => { pb.paint(); }, [selectedEl, pb]);
  // The overlay canvas is sized to what is on screen (times the device pixel ratio, capped), never to 1080x1920.
  const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const frameMs = 1000 / (safeDoc.canvas.fps || 30);

  // ── actions ────────────────────────────────────────────────────────────────
  const commit = (next: EditDocument) => onChange(next, true);
  function splitAtPlayhead() {
    if (!doc) return;
    const trackId = selection?.kind === "clip" ? selection.trackId : mainTrack(doc).id;
    commit(splitClipAt(doc, trackId, pb.tMs));
  }
  /** Trim-to-playhead: the selected clip, else the main clip under the playhead. "left" keeps
   *  what is after the playhead, "right" keeps what is before it. */
  function trimAtPlayhead(side: "left" | "right") {
    if (!doc) return;
    let trackId: string | null = null, clipId: string | null = null;
    if (selection?.kind === "clip") { trackId = selection.trackId; clipId = selection.id; }
    else { const hit = clipAt(mainTrack(doc), pb.tMs); if (hit) { trackId = mainTrack(doc).id; clipId = hit.clip.id; } }
    if (!trackId || !clipId) return;
    const next = trimClipToTime(doc, trackId, clipId, pb.tMs, side);
    if (next !== doc) commit(next);
  }
  function deleteSelected() {
    if (!doc || !selection) return;
    if (selection.kind === "clip") commit(deleteClip(doc, selection.trackId, selection.id));
    else if (selection.kind === "cue") commit(deleteCue(doc, selection.id));
    else if (selection.kind === "transition") commit(setTransition(doc, selection.afterClipId, null));
    else commit(deleteText(doc, selection.id));
    setSelection(null);
  }
  /** Transitions: to the selected cut, or to every cut. */
  function applyTransition(type: TransitionType | null, durationMs: number, toAll: boolean) {
    if (!doc) return;
    if (!toAll && selection?.kind === "transition") commit(setTransition(doc, selection.afterClipId, type, durationMs));
    else commit(setAllTransitions(doc, type, durationMs));
  }

  // ── caption presets, per client (Client.subtitleStyle = { default, presets }) ──
  async function persistClientCaptions(next: ClientCaptionSettings): Promise<boolean> {
    if (!project) return false;
    try {
      const r = await fetch(`/api/clients/${project.clientId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subtitleStyle: next }) });
      if (!r.ok) return false;
      setClientCaptions(next);
      return true;
    } catch { return false; }
  }
  const presetsApi: PresetsApi = {
    client: clientCaptions.presets,
    current: doc?.captionStyle ?? EMPTY_DOC.captionStyle,
    apply: (style: CaptionStyle) => { if (doc) commit(setCaptionStyle(doc, style)); },
    saveCurrent: (name: string) => {
      if (!doc) return Promise.resolve(false);
      const preset: NamedPreset = { id: `p_${Date.now().toString(36)}`, name, style: doc.captionStyle };
      return persistClientCaptions({ ...clientCaptions, presets: [...clientCaptions.presets, preset] });
    },
    remove: (id: string) => persistClientCaptions({ ...clientCaptions, presets: clientCaptions.presets.filter((p) => p.id !== id) }),
  };
  const saveClientDefault = () => (doc ? persistClientCaptions({ ...clientCaptions, default: doc.captionStyle }) : Promise.resolve(false));
  const stillFrame = doc ? (() => { const first = mainTrack(doc).clips[0]; return first ? pb.thumbs[first.assetId] ?? null : null; })() : null;
  function addCaptionHere() {
    if (!doc) return;
    commit(addCue(doc, { startMs: pb.tMs, endMs: pb.tMs + 1500, lines: ["Caption"], words: null, styleOverride: null }));
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
  }
  function addToMain(assetId: string) {
    if (!doc) return;
    commit(addClip(doc, mainTrack(doc).id, assetId, 0)); // appended; the main track is contiguous
  }
  /** An imported file joins the media library only; it is placed from the Media panel. */
  function addUploadedAsset(url: string, name: string) {
    if (!doc) return;
    commit(addAsset(doc, { url, name }).doc);
  }
  function removeAssetAndClips(assetId: string) {
    if (!doc) return;
    commit(removeAsset(doc, assetId));
    setSelection(null);
  }

  // ── auto-captions ──────────────────────────────────────────────────────────
  const [acState, setAcState] = useState<AutoCaptionsState>({ phase: "idle", message: "" });
  const [useScript, setUseScript] = useState(true);
  /** Words → cues → track, from a transcript in asset time. Pure and local: re-layout after a
   *  trim, a reorder, a style change or a toggle of the script wording never calls the server. */
  function applyTranscript(base: EditDocument, assets: AssetTranscript[], fromCache: string[]): EditDocument {
    let words = timelineWords(base, assets).map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs }));
    let aligned = false, ratio: number | null = null, detail = "";
    if (useScript && scriptText) {
      const r = alignToScript(words, scriptText);
      if (r) {
        ratio = r.ratio;
        if (r.ratio >= 0.6) { words = r.words; aligned = true; detail = ` · script wording for ${Math.round(r.ratio * 100)}% (${r.substituted} corrected, ${r.improvised} improvised, ${r.skipped} skipped)`; }
        else detail = ` · script not followed (${Math.round(r.ratio * 100)}% matched), kept Whisper's words`;
      }
    }
    const cues = layoutCaptions(words, base.captionStyle);
    const transcript: Transcript = { source: "whisper-1", createdAt: new Date().toISOString(), assets, alignedToScript: aligned, alignRatio: ratio };
    setAcState({ phase: "done", message: `${cues.length} captions from ${words.length} words${fromCache.length ? ` (${fromCache.length} clip${fromCache.length === 1 ? "" : "s"} from cache)` : ""}${detail}` });
    return setTranscript(replaceCues(base, cues), transcript);
  }
  async function generateCaptions() {
    const d = docRef.current;
    if (!d || !project) return;
    const assetIds = [...new Set(mainTrack(d).clips.map((c) => c.assetId))].filter((id) => d.assets.find((a) => a.id === id)?.durationMs != null);
    if (assetIds.length === 0) { setAcState({ phase: "error", message: "No clips on the main track yet." }); return; }
    setAcState({ phase: "working", message: "Extracting audio on the server and transcribing with word timings…" });
    try {
      const r = await fetch(`/api/edit-projects/${project.id}/transcribe`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assetIds }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      if (typeof j.script === "string" && j.script.trim()) setScriptText(j.script);
      const cur = docRef.current;
      if (!cur) return;
      commit(applyTranscript(cur, j.assets as AssetTranscript[], j.cached as string[]));
    } catch (e) {
      setAcState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
  function relayoutCaptions() {
    const d = docRef.current;
    if (!d?.transcript) return;
    commit(applyTranscript(d, d.transcript.assets, []));
  }
  const autoCaptions: AutoCaptions = {
    state: acState, useScript, setUseScript, hasScript: !!scriptText, hasTranscript: !!doc?.transcript,
    canGenerate: !!doc && mainTrack(doc).clips.some((c) => doc.assets.find((a) => a.id === c.assetId)?.durationMs != null),
    generate: generateCaptions, relayout: relayoutCaptions,
  };

  // Keyboard: space play, ←/→ frame step (shift = 1 s), S split, Delete, ⌘Z / ⌘⇧Z.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === " ") { e.preventDefault(); pb.toggle(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); pb.seek(pb.tMs - (e.shiftKey ? 1000 : frameMs)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); pb.seek(pb.tMs + (e.shiftKey ? 1000 : frameMs)); }
      else if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); splitAtPlayhead(); }
      else if (e.key.toLowerCase() === "q" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); trimAtPlayhead("left"); }
      else if (e.key.toLowerCase() === "w" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); trimAtPlayhead("right"); }
      else if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setSnap(!snap); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  // ── the preview as a direct-manipulation surface ──────────────────────────
  // Handles on the selected element scale (corners and edges, uniform: the model has one scale)
  // or rotate (the stem handle); the body moves, snapping to the canvas centre lines and the
  // safe margins with guides drawn while dragging. Everything writes the same Transform the
  // Details panel edits, so the two stay in sync by construction.
  function onPreviewPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current, d = docRef.current;
    if (!c || !d || e.button !== 0) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const rect = c.getBoundingClientRect();
    const toDoc = (cx: number, cy: number) => ({ x: ((cx - rect.left) / rect.width) * d.canvas.width, y: ((cy - rect.top) / rect.height) * d.canvas.height });
    const p = toDoc(e.clientX, e.clientY);
    const docPxPerScreenPx = d.canvas.width / rect.width;
    const tol = 14 * docPxPerScreenPx;
    const sizeFor = (id: string) => { const v = pb.videoFor(id); return v && v.videoWidth ? { width: v.videoWidth, height: v.videoHeight } : null; };
    const sel: Selected | null = selection && (selection.kind === "clip" || selection.kind === "text") ? selection : null;
    const current = selectionBox(d, sel, pb.tMs, sizeFor);

    const transformOf = (s: Selected) => s.kind === "text"
      ? d.tracks.flatMap((t) => (t.kind === "text" ? t.elements : [])).find((x) => x.id === s.id)!.transform
      : [mainTrack(d), overlayTrack(d)].find((t) => t?.id === s.trackId)!.clips.find((x) => x.id === s.id)!.transform;
    const withTransform = (base: EditDocument, s: Selected, t: typeof IDENTITY_TRANSFORM) => s.kind === "text"
      ? updateText(base, s.id, { transform: t })
      : updateClip(base, s.trackId, s.id, { transform: t });

    // 1. A handle on the current selection?
    if (sel && current) {
      const h = hitHandle(current.box, p, tol);
      if (h) {
        e.preventDefault();
        const base = d, t0 = transformOf(sel), box = current.box;
        const startDist = Math.max(1, Math.hypot(p.x - box.cx, p.y - box.cy));
        const startAngle = Math.atan2(p.y - box.cy, p.x - box.cx) * 180 / Math.PI - t0.rotation;
        let last = base;
        draggingRef.current = true;
        const move = (ev: PointerEvent) => {
          const q = toDoc(ev.clientX, ev.clientY);
          if (h === "rotate") {
            let rot = Math.atan2(q.y - box.cy, q.x - box.cx) * 180 / Math.PI - startAngle;
            rot = ((rot % 360) + 540) % 360 - 180;
            for (const s of [0, 90, 180, -90, -180]) if (Math.abs(rot - s) < 3) rot = s === -180 ? 180 : s;
            last = withTransform(base, sel, { ...t0, rotation: Math.round(rot * 10) / 10 });
          } else {
            const scale = Math.max(0.05, Math.min(5, t0.scale * (Math.hypot(q.x - box.cx, q.y - box.cy) / startDist)));
            last = withTransform(base, sel, { ...t0, scale: Math.round(scale * 1000) / 1000 });
          }
          onChange(last, false);
        };
        const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); draggingRef.current = false; onChange(last, true); pb.paint(true); };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        return;
      }
    }

    // 2. An element body: text on top, then b-roll (topmost first), then the main clip.
    let target: Selected | null = null;
    const textId = textElementAt(ctx, d, pb.tMs, p.x, p.y);
    if (textId) target = { kind: "text", id: textId };
    if (!target) {
      const ov = overlayTrack(d);
      const hit = ov?.clips.slice().reverse().find((cl) => pb.tMs >= cl.at && pb.tMs < cl.at + clipLengthMs(cl) && insideBox(selectionBox(d, { kind: "clip", trackId: ov.id, id: cl.id }, pb.tMs, sizeFor)!.box, p));
      if (hit && ov) target = { kind: "clip", trackId: ov.id, id: hit.id };
    }
    if (!target) {
      const main = mainTrack(d);
      const hit = main.clips.find((cl) => pb.tMs >= cl.at && pb.tMs < cl.at + clipLengthMs(cl));
      if (hit && insideBox(selectionBox(d, { kind: "clip", trackId: main.id, id: hit.id }, pb.tMs, sizeFor)!.box, p)) target = { kind: "clip", trackId: main.id, id: hit.id };
    }
    if (!target) { setSelection(null); return; }
    e.preventDefault();
    setSelection(target);
    const base = d, t0 = transformOf(target), start = p;
    const box0 = selectionBox(d, target, pb.tMs, sizeFor)!.box;
    let last = base;
    draggingRef.current = true;
    const move = (ev: PointerEvent) => {
      const q = toDoc(ev.clientX, ev.clientY);
      const raw = { cx: box0.cx + (q.x - start.x), cy: box0.cy + (q.y - start.y) };
      const snapped = snap ? snapCentre(d, box0, raw.cx, raw.cy, 10 * docPxPerScreenPx) : { ...raw, guides: { v: [], h: [] } };
      guidesRef.current = snapped.guides.v.length || snapped.guides.h.length ? snapped.guides : { v: [], h: [] };
      // The box centre and the transform origin coincide for clips; for text the box is the laid-out block, which is centred on the origin too.
      last = withTransform(base, target!, { ...t0, x: t0.x + (snapped.cx - box0.cx) / d.canvas.width, y: t0.y + (snapped.cy - box0.cy) / d.canvas.height });
      onChange(last, false);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); draggingRef.current = false; guidesRef.current = null; onChange(last, true); pb.paint(true); };
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
  const loadingAssets = doc.assets.filter((a) => !pb.status[a.id] && a.durationMs == null);
  const failedAssets = doc.assets.filter((a) => pb.status[a.id]?.state === "failed").map((a) => ({ asset: a, reason: (pb.status[a.id] as { reason: string }).reason }));

  const saveLabel = saveState === "saved" ? "Saved" : saveState === "dirty" ? "Unsaved changes" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed, retrying" : "Conflict";

  return (
    <div className="editor-theme h-screen flex flex-col bg-canvas-2 text-ink overflow-hidden" style={{ height: "100dvh" }}>
      {/* Top bar: save state on the left, project name centred, actions on the right (CapCut's row) */}
      <header className="h-14 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center px-4">
        <div className="flex items-center gap-3 min-w-0">
          <a href={backHref} className="text-xs font-semibold text-muted hover:text-ink shrink-0">← Kanban</a>
          <span className={`text-xs truncate ${saveState === "error" ? "text-danger-600" : saveState === "conflict" ? "text-warn-700" : "text-muted"}`}>{saveLabel}</span>
        </div>
        <div className="text-sm font-semibold truncate px-4">{draftTitle || `Draft #${draftId}`}</div>
        <div className="flex items-center justify-end gap-1.5">
          <IconButton name="layout" label={`Layout presets — ${NOT_BUILT.toLowerCase()}`} disabled />
          <button disabled title={`Share — ${NOT_BUILT.toLowerCase()}`} className="o-btn o-btn-ghost text-xs h-8 py-0 disabled:opacity-40 disabled:cursor-not-allowed"><Icon name="share" size={14} />Share</button>
          <button className="o-btn o-btn-accent text-xs h-8 py-0" disabled title="Export arrives in Phase 4">Export</button>
        </div>
      </header>

      {/* Conflict banner */}
      {conflict && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-warn-50 border-b border-warn-200 text-xs text-warn-700">
          <span className="font-semibold">{conflict.updatedBy || "Someone"} saved this project at {new Date(conflict.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} while you were editing.</span>
          <span className="text-warn-600">Your changes are not saved. Reload their version (loses yours) or overwrite it with yours.</span>
          <span className="flex-1" />
          <button onClick={reloadTheirs} className="o-btn o-btn-primary text-xs">Reload their version</button>
          <button onClick={overwriteWithMine} className="o-btn o-btn-ghost text-xs">Overwrite with mine</button>
        </div>
      )}

      {/* Three sibling panels in a row, each with its own header; the timeline spans the full width below.
          Under ~1000 px the page scrolls sideways rather than letting the panels collapse into slivers. */}
      <div ref={shellRef} className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="h-full min-w-[1040px] flex flex-col px-2.5 pb-2.5">
          <div className="flex-1 min-h-0 flex gap-2.5">
            {/* Left third: tab bar in its header, sub-nav column, content with toolbar, footer */}
            <aside className={panelCls + " w-[33%] min-w-[420px] shrink-0 min-h-0 overflow-hidden"}>
              <LeftPanel tab={tab} onTab={setTab} doc={doc} status={pb.status} thumbs={pb.thumbs} tMs={pb.tMs} selection={selection} onSelect={setSelection} onSeek={pb.seek}
                onAddToMain={addToMain} onAddBroll={addBroll} onUploaded={addUploadedAsset} onRetry={pb.retryAsset} onRemoveAsset={removeAssetAndClips}
                onAddCaption={addCaptionHere} onAddText={addTextHere} autoCaptions={autoCaptions} presets={presetsApi} still={stillFrame} transitions={{ apply: applyTransition }} />
            </aside>

            {/* Centre, the largest: "Preview — <name>" header, the video, transport under it */}
            <section ref={previewBox} className={panelCls + " flex-1 min-w-[320px] min-h-0 flex flex-col"}>
              <div className="h-[46px] shrink-0 flex items-center gap-2 px-4 border-b border-line-soft">
                <span className="text-sm font-semibold text-ink truncate">Preview <span className="text-muted font-normal">— {draftTitle || `Draft #${draftId}`}</span></span>
                <span className="flex-1" />
                {loadingAssets.length > 0 && <span className="text-[10px] text-faint">Reading {loadingAssets.length} clip length{loadingAssets.length === 1 ? "" : "s"}…</span>}
                {failedAssets.length > 0 && <span className="text-[10px] font-semibold text-danger-600">{failedAssets.length} clip{failedAssets.length === 1 ? "" : "s"} failed</span>}
                <IconButton name="menu" label={`Preview options — ${NOT_BUILT.toLowerCase()}`} disabled />
              </div>
              <div ref={previewArea} className="flex-1 min-h-0 flex items-center justify-center p-3">
                <div className="relative overflow-hidden rounded-md bg-black" style={{ width: fit.w, height: fit.h }}>
                  {/* Real <video> elements live here (hardware decode + composite); the canvas above paints only captions and text. */}
                  <div ref={videoLayerRef} className="absolute inset-0" />
                  <canvas ref={canvasRef} width={Math.max(1, Math.round(fit.w * dpr))} height={Math.max(1, Math.round(fit.h * dpr))} onPointerDown={onPreviewPointerDown}
                    className="absolute inset-0 w-full h-full touch-none" style={{ zIndex: 50 }} />
                  {/* Overlays on the media: black/white chrome by design (dark-mode doc, media rule). */}
                  <div className="absolute top-2 left-2 right-2 flex flex-col gap-1 pointer-events-none">
                    {failedAssets.map(({ asset, reason }) => (
                      <div key={asset.id} className="pointer-events-auto flex items-center gap-2 text-[10px] text-white bg-black/70 rounded px-2 py-1">
                        <span className="min-w-0 flex-1 truncate"><span className="font-semibold">{asset.name}</span> failed: {reason}</span>
                        <button onClick={() => pb.retryAsset(asset.id)} className="font-semibold underline shrink-0">Retry</button>
                        <button onClick={() => removeAssetAndClips(asset.id)} className="font-semibold underline shrink-0">Remove</button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="h-11 shrink-0 grid grid-cols-[1fr_auto_1fr] items-center px-3 border-t border-line-soft">
                <span className="text-xs font-mono text-ink-2 tabular-nums">{fmtTime(pb.tMs)} <span className="text-faint">/ {fmtTime(pb.durationMs)}</span></span>
                <div className="flex items-center gap-1">
                  <IconButton name="prevFrame" label="Previous frame (←)" onClick={() => pb.seek(pb.tMs - frameMs)} />
                  <button onClick={pb.toggle} title={pb.playing ? "Pause (space)" : "Play (space)"} aria-label={pb.playing ? "Pause" : "Play"}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md bg-accent text-on-accent hover:bg-accent-strong"><Icon name={pb.playing ? "pause" : "play"} /></button>
                  <IconButton name="nextFrame" label="Next frame (→)" onClick={() => pb.seek(pb.tMs + frameMs)} />
                </div>
                <div className="flex items-center justify-end gap-0.5">
                  <IconButton name="volume" label={`Preview volume — ${NOT_BUILT.toLowerCase()}`} disabled />
                  <IconButton name="fit" label={`Fit / fill — ${NOT_BUILT.toLowerCase()}`} disabled />
                  <IconButton name="ratio" label={`Aspect ratio — ${NOT_BUILT.toLowerCase()}`} disabled />
                  <IconButton name="fullscreen" label={`Full screen — ${NOT_BUILT.toLowerCase()}`} disabled />
                </div>
              </div>
            </section>

            {/* Right, narrow: "Details" header, the selection's properties, a footer row */}
            <aside className={panelCls + " w-[30%] min-w-[300px] shrink-0 min-h-0 flex flex-col"}>
              <div className="h-[46px] shrink-0 flex items-center px-4 border-b border-line-soft">
                <span className="text-sm font-semibold text-accent">Details</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 pb-6">
                <Inspector doc={doc} selection={selection} clientId={project.clientId} onChange={onChange} onSelect={setSelection} onSaveClientDefault={saveClientDefault} />
              </div>
              <div className="h-11 shrink-0 flex items-center justify-end px-3 border-t border-line-soft">
                <button disabled title={`Modify — ${NOT_BUILT.toLowerCase()}`} className="o-btn o-btn-ghost text-xs h-8 py-0 disabled:opacity-40 disabled:cursor-not-allowed">Modify</button>
              </div>
            </aside>
          </div>

          {/* Divider: drag to give the timeline more or less room, double-click to reset */}
          <div onPointerDown={onDividerPointerDown} onDoubleClick={resetDivider} title="Drag to resize the timeline · double-click to reset"
            className="group h-3 shrink-0 flex items-center justify-center cursor-row-resize touch-none">
            <span className="h-1 w-12 rounded-full bg-line-strong group-hover:bg-accent transition-colors" />
          </div>

          {/* Bottom: the timeline spans the full width with its own toolbar; the tracks scroll inside it */}
          <section className={panelCls + " shrink-0 flex flex-col min-h-0"} style={{ height: timelineH }}>
            <div className="h-10 shrink-0 flex items-center gap-1 px-2 border-b border-line-soft">
              <IconButton name="plus" label={`Add at playhead — ${NOT_BUILT.toLowerCase()} (use Media's + Main)`} disabled />
              <button disabled title={`Select mode — ${NOT_BUILT.toLowerCase()} (one mode today)`} className="h-8 px-1.5 inline-flex items-center gap-0.5 rounded-md text-ink-2 disabled:opacity-35 disabled:cursor-not-allowed"><Icon name="select" /><Icon name="chevron" size={12} /></button>
              <span className="w-px h-5 bg-line-hard mx-1" />
              <IconButton name="undo" label="Undo (⌘Z)" onClick={undo} disabled={!histSize.past} />
              <IconButton name="redo" label="Redo (⌘⇧Z)" onClick={redo} disabled={!histSize.future} />
              <span className="w-px h-5 bg-line-hard mx-1" />
              <IconButton name="trimLeft" label="Trim to the left of the playhead (Q)" onClick={() => trimAtPlayhead("left")} />
              <IconButton name="split" label="Split at playhead (S)" onClick={splitAtPlayhead} />
              <IconButton name="trimRight" label="Trim to the right of the playhead (W)" onClick={() => trimAtPlayhead("right")} />
              <IconButton name="trash" label="Delete selection (⌫)" onClick={deleteSelected} disabled={!selection} />
              <IconButton name="freeze" label="Freeze frame — not built yet (the document has no freeze-frame clip type)" disabled />
              <span className="flex-1" />
              <IconButton name="mic" label={`Voice-over — ${NOT_BUILT.toLowerCase()}`} disabled />
              <IconButton name="snap" label={snap ? "Snapping on (N)" : "Snapping off (N)"} onClick={() => setSnap(!snap)} active={snap} />
              <IconButton name="link" label={`Link / unlink — ${NOT_BUILT.toLowerCase()}`} disabled />
              <IconButton name="mirror" label={`Mirror — ${NOT_BUILT.toLowerCase()}`} disabled />
              <span className="w-px h-5 bg-line-hard mx-1" />
              <IconButton name="zoomOut" label="Zoom out" onClick={() => setPxPerSec((z) => Math.max(ZOOM_MIN, z / 1.5))} />
              <input type="range" min={0} max={100} value={zoomToSlider(pxPerSec)} onChange={(e) => setPxPerSec(sliderToZoom(Number(e.target.value)))}
                title={`${Math.round(pxPerSec)} px per second`} aria-label="Timeline zoom" className="w-28 h-8 accent-[var(--color-accent)]" />
              <IconButton name="zoomIn" label="Zoom in" onClick={() => setPxPerSec((z) => Math.min(ZOOM_MAX, z * 1.5))} />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <Timeline doc={doc} tMs={pb.tMs} durationMs={pb.durationMs} pxPerSec={pxPerSec} selection={selection} assetStatus={pb.status} snap={snap} onZoom={setPxPerSec} onSeek={pb.seek} onSelect={setSelection} onChange={onChange} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Every region is a floating panel: surface, hairline, the 10 px radius token, soft shadow. */
const panelCls = "rounded-md bg-surface border border-line shadow-soft";

const EMPTY_DOC: EditDocument = { v: 1, canvas: { ...DEFAULT_CANVAS }, assets: [], tracks: [{ id: "main", kind: "video", role: "main", clips: [], transitions: [] }], captionStyle: DEFAULT_CAPTION_STYLE, transcript: null };

