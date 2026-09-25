"use client";

// The playback engine: one hidden <video> per asset, a playhead in ms, and a canvas that is
// repainted from the document on every frame. Frame accuracy comes from treating the ACTIVE
// main clip's video element as the clock while playing (the playhead is derived from its
// currentTime, never from wall time) and from redrawing on `seeked` while scrubbing.
//
// Every asset's metadata probe is timed out and its failure diagnosed, so one dead media URL
// marks that one clip failed instead of leaving the editor on a spinner forever.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, EditDocument, Ms } from "@/features/editor/model/document";
import { applyAssetMetadata, clipAt, clipLengthMs, mainTrack, overlayTrack } from "@/features/editor/model/timeline";
import { documentDurationMs } from "@/features/editor/model/document";
import { drawFrame } from "@/features/editor/render/compositor";
import { videoSrc } from "@/shared/media/videoSrc";

const SYNC_TOLERANCE_MS = 120;
const METADATA_TIMEOUT_MS = 20000;

export type AssetStatus = { state: "loading" } | { state: "ready" } | { state: "failed"; reason: string };

type Want = { sourceMs: number; muted: boolean; volume: number };

/** Why a <video> could not load its metadata, in words a person can act on. Asks the same URL
 *  the element used (the /api/vid proxy for R2 and Instagram media) for its first byte, since
 *  the media element itself only reports a code. */
async function diagnose(src: string, v: HTMLVideoElement | null, timedOut: boolean): Promise<string> {
  try {
    const r = await fetch(src, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
    // /api/vid answers 404 for ANY upstream failure (gone, expired, or r2.dev rate-limiting), so say so.
    if (r.status === 404) return "media unavailable (file gone, link expired, or storage rate-limited; retry in a moment)";
    if (r.status === 403) return "media blocked (403)";
    if (r.status >= 500) return `media server error (${r.status})`;
    if (!r.ok && r.status !== 206) return `media returned HTTP ${r.status}`;
  } catch {
    return "could not reach the media (offline or blocked)";
  }
  const code = v?.error?.code;
  if (code === 3) return "file cannot be decoded by this browser";
  if (code === 4) return "file format not supported by this browser";
  if (timedOut) return `no metadata after ${METADATA_TIMEOUT_MS / 1000} s (very large or unsupported file)`;
  return "failed to load";
}

/** Owns the hidden video elements. Mutation of DOM elements happens in here, behind methods. */
class VideoPool {
  private map = new Map<string, HTMLVideoElement>();
  private timers = new Map<string, number>();
  private attempts = new Map<string, number>();
  get(assetId: string): HTMLVideoElement | null { return this.map.get(assetId) ?? null; }
  has(assetId: string) { return this.map.has(assetId); }
  ensure(asset: Asset, on: { meta: (m: { durationMs: number; width: number; height: number }) => void; frame: () => void; fail: (reason: string) => void }) {
    if (this.map.has(asset.id)) return;
    const attempt = (this.attempts.get(asset.id) ?? 0) + 1;
    this.attempts.set(asset.id, attempt);
    const base = videoSrc(asset.url);
    const src = attempt > 1 ? `${base}${base.includes("?") ? "&" : "?"}retry=${attempt}` : base;
    const v = document.createElement("video");
    v.src = src;
    v.preload = "auto";
    v.playsInline = true;
    v.muted = true;
    v.style.display = "none";
    document.body.appendChild(v);
    this.map.set(asset.id, v);
    let settled = false;
    const settle = () => { settled = true; const t = this.timers.get(asset.id); if (t) { window.clearTimeout(t); this.timers.delete(asset.id); } };
    const fail = async (timedOut: boolean) => {
      if (settled) return;
      settle();
      on.fail(await diagnose(src, v, timedOut));
    };
    v.addEventListener("loadedmetadata", () => {
      if (settled) return;
      const m = { durationMs: Math.round(v.duration * 1000), width: v.videoWidth, height: v.videoHeight };
      if (!Number.isFinite(m.durationMs) || m.durationMs <= 0) { fail(false); return; }
      settle();
      on.meta(m);
    });
    v.addEventListener("error", () => fail(false));
    v.addEventListener("seeked", on.frame);
    v.addEventListener("loadeddata", on.frame);
    this.timers.set(asset.id, window.setTimeout(() => fail(true), METADATA_TIMEOUT_MS));
  }
  remove(assetId: string) {
    const v = this.map.get(assetId);
    if (v) { v.pause(); v.removeAttribute("src"); v.load(); v.remove(); this.map.delete(assetId); }
    const t = this.timers.get(assetId); if (t) { window.clearTimeout(t); this.timers.delete(assetId); }
  }
  /** Puts every element where `wanted` says, pausing what is not on screen. */
  apply(wanted: Map<string, Want>, forPlayback: boolean) {
    for (const [assetId, v] of this.map) {
      const w = wanted.get(assetId);
      if (!w) { if (!v.paused) v.pause(); continue; }
      v.muted = w.muted;
      v.volume = w.volume;
      if (Math.abs(v.currentTime * 1000 - w.sourceMs) > (forPlayback ? SYNC_TOLERANCE_MS : 1)) {
        try { v.currentTime = w.sourceMs / 1000; } catch { /* metadata not loaded yet */ }
      }
      if (forPlayback && v.paused) v.play().catch(() => {});
      if (!forPlayback && !v.paused) v.pause();
    }
  }
  pauseAll() { for (const v of this.map.values()) if (!v.paused) v.pause(); }
  dispose() { for (const id of [...this.map.keys()]) this.remove(id); }
}

export function usePlayback(doc: EditDocument, canvasRef: React.RefObject<HTMLCanvasElement | null>, setDoc: (f: (d: EditDocument) => EditDocument) => void) {
  const [tMs, setT] = useState<Ms>(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<Record<string, AssetStatus>>({});
  const pool = useRef<VideoPool | null>(null);
  const docRef = useRef(doc);
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const raf = useRef(0);
  const durationMs = documentDurationMs(doc);

  useEffect(() => { docRef.current = doc; }, [doc]);

  const getPool = useCallback(() => (pool.current ??= new VideoPool()), []);
  const videoFor = useCallback((assetId: string) => getPool().get(assetId), [getPool]);

  const paint = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    drawFrame(ctx, docRef.current, tRef.current, { videoFor });
  }, [canvasRef, videoFor]);

  const probe = useCallback((a: Asset) => {
    setStatus((s) => ({ ...s, [a.id]: { state: "loading" } }));
    getPool().ensure(a, {
      meta: (meta) => {
        setDoc((d) => applyAssetMetadata(d, a.id, meta));
        setStatus((s) => ({ ...s, [a.id]: { state: "ready" } }));
      },
      fail: (reason) => setStatus((s) => ({ ...s, [a.id]: { state: "failed", reason } })),
      frame: () => { if (!playingRef.current) paint(); },
    });
  }, [getPool, setDoc, paint]);

  // Create a hidden video element per asset once; read its metadata into the document.
  useEffect(() => {
    const p = getPool();
    for (const a of doc.assets) if (a.kind === "video" && !p.has(a.id)) probe(a);
  }, [doc.assets, probe, getPool]);

  // Drop elements for assets that left the document.
  useEffect(() => {
    const ids = new Set(doc.assets.map((a) => a.id));
    setStatus((s) => { const n: Record<string, AssetStatus> = {}; let changed = false; for (const k in s) { if (ids.has(k)) n[k] = s[k]; else { changed = true; getPool().remove(k); } } return changed ? n : s; });
  }, [doc.assets, getPool]);

  useEffect(() => () => { pool.current?.dispose(); pool.current = null; }, []);

  /** Re-probes one asset with a fresh element and a cache-busted URL. */
  const retryAsset = useCallback((assetId: string) => {
    const a = docRef.current.assets.find((x) => x.id === assetId);
    if (!a) return;
    getPool().remove(assetId);
    probe(a);
  }, [getPool, probe]);

  /** What every asset's element should be doing at `t`. */
  const wantedAt = useCallback((t: Ms): Map<string, Want> => {
    const d = docRef.current;
    const main = clipAt(mainTrack(d), t);
    const wanted = new Map<string, Want>();
    if (main) wanted.set(main.clip.assetId, { sourceMs: main.sourceMs, muted: main.clip.muted, volume: main.clip.volume });
    const ov = overlayTrack(d);
    if (ov) for (const c of ov.clips) {
      if (t >= c.at && t < c.at + clipLengthMs(c) && !wanted.has(c.assetId)) wanted.set(c.assetId, { sourceMs: c.inMs + (t - c.at), muted: true, volume: 0 });
    }
    return wanted;
  }, []);

  const position = useCallback((t: Ms, forPlayback: boolean) => { getPool().apply(wantedAt(t), forPlayback); }, [getPool, wantedAt]);

  const seek = useCallback((t: Ms) => {
    const clamped = Math.max(0, Math.min(documentDurationMs(docRef.current), Math.round(t)));
    tRef.current = clamped;
    setT(clamped);
    position(clamped, playingRef.current);
    paint();
  }, [position, paint]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    cancelAnimationFrame(raf.current);
    getPool().pauseAll();
    paint();
  }, [paint, getPool]);

  const play = useCallback(() => {
    const d = docRef.current;
    const total = documentDurationMs(d);
    if (total <= 0) return;
    if (tRef.current >= total) { tRef.current = 0; setT(0); }
    playingRef.current = true;
    setPlaying(true);
    position(tRef.current, true);
    const tick = () => {
      if (!playingRef.current) return;
      const dd = docRef.current;
      const main = clipAt(mainTrack(dd), tRef.current);
      if (!main) { pause(); return; }
      const v = getPool().get(main.clip.assetId);
      let t = tRef.current;
      if (v && v.readyState >= 2) {
        // The active clip's video is the clock.
        t = main.clip.at + (v.currentTime * 1000 - main.clip.inMs);
        const end = main.clip.at + clipLengthMs(main.clip);
        if (t >= end - 8 || v.ended) {
          const next = mainTrack(dd).clips[main.index + 1];
          if (!next) { tRef.current = end; setT(end); pause(); return; }
          t = next.at;
        }
      }
      tRef.current = Math.max(0, t);
      setT(tRef.current);
      position(tRef.current, true);
      paint();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [position, paint, pause, getPool]);

  // Repaint whenever the document changes while paused (captions, text, trims).
  useEffect(() => { if (!playingRef.current) { position(tRef.current, false); paint(); } }, [doc, position, paint]);

  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);

  return { tMs, playing, durationMs, status, retryAsset, seek, play, pause, toggle, paint, videoFor };
}
