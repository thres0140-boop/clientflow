"use client";

// The playback engine. Video is never copied to a canvas: each asset is a real <video> element
// mounted in the preview's video layer, shown and positioned with CSS when its clip is on
// screen (hardware-decoded, hardware-composited), and a TRANSPARENT canvas above it paints only
// captions and text. Frame accuracy comes from treating the ACTIVE main clip's <video> as the
// clock while playing: the playhead is derived from its presentation time (requestVideoFrameCallback's
// mediaTime, else currentTime), never from wall time. While paused, every seek positions the
// elements and repaints the overlay.
//
// Media is played straight from R2 through a short-lived presigned GET on the S3 endpoint
// (/api/r2/sign-get), not through the /api/vid function proxy; the proxy stays as the fallback
// and for non-R2 hosts. Every asset's metadata probe is timed out and its failure diagnosed, so
// one dead media URL marks that one clip failed instead of leaving the editor on a spinner.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, EditDocument, Ms } from "@/features/editor/model/document";
import { applyAssetMetadata, clipAt, clipLengthMs, mainTrack, overlayTrack, sourceAt, transitionAt } from "@/features/editor/model/timeline";
import { documentDurationMs } from "@/features/editor/model/document";
import { clipRect, drawOverlay, overlayKey } from "@/features/editor/render/compositor";
import { videoSrc } from "@/shared/media/videoSrc";

const SYNC_TOLERANCE_MS = 120;
const METADATA_TIMEOUT_MS = 20000;

export type AssetStatus = { state: "ready" } | { state: "failed"; reason: string };
export type Display = { w: number; h: number };
/** Extra chrome painted over the overlay (selection box, guides). `key` changes whenever it would draw differently. */
export type OverlayChrome = { key: () => string; draw: (ctx: CanvasRenderingContext2D, doc: EditDocument, tMs: Ms) => void };

type Want = { sourceMs: number; muted: boolean; volume: number; rect: { x: number; y: number; w: number; h: number }; rotation: number; opacity: number; z: number; offset?: { x: number; y: number }; scaleMul?: number; rate: number };
type VideoWithVFC = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number; cancelVideoFrameCallback?: (id: number) => void };

/** Why a <video> could not load its metadata, in words a person can act on. Asks the same URL
 *  the element used for its first byte, since the media element itself only reports a code. */
async function diagnose(src: string, v: HTMLVideoElement | null, timedOut: boolean): Promise<string> {
  try {
    const r = await fetch(src, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
    // /api/vid answers 404 for ANY upstream failure (gone, expired, or r2.dev rate-limiting), so say so.
    if (r.status === 404) return "media unavailable (file gone, link expired, or storage rate-limited; retry in a moment)";
    if (r.status === 403) return "media blocked (403: the signed link may have expired; retry)";
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

const isR2 = (url: string) => /\.r2\.dev\//.test(url);

/** Where a <video> should load from: a presigned GET on the R2 S3 endpoint for our own objects
 *  (direct, no function in the way, no r2.dev throttle), else the same-origin proxy or the url
 *  itself, exactly as every other player in the app. */
async function resolveSrc(url: string): Promise<{ src: string; signed: boolean }> {
  if (isR2(url)) {
    try {
      const r = await fetch(`/api/r2/sign-get?url=${encodeURIComponent(url)}`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok && typeof j?.url === "string") return { src: j.url, signed: true };
    } catch { /* fall through to the proxy */ }
  }
  return { src: videoSrc(url), signed: false };
}

/** Owns the video elements: creation, source resolution, positioning and playback state. All
 *  DOM mutation happens in here, behind methods. */
class VideoPool {
  private map = new Map<string, HTMLVideoElement>();
  private timers = new Map<string, number>();
  private attempts = new Map<string, number>();
  private mount: HTMLElement | null = null;
  get(assetId: string): HTMLVideoElement | null { return this.map.get(assetId) ?? null; }
  has(assetId: string) { return this.map.has(assetId); }
  ids(): string[] { return [...this.map.keys()]; }
  /** The preview's video layer. Elements created before it existed are moved into it. */
  setMount(el: HTMLElement | null) {
    if (el === this.mount) return;
    this.mount = el;
    if (el) for (const v of this.map.values()) el.appendChild(v);
  }
  ensure(asset: Asset, on: { meta: (m: { durationMs: number; width: number; height: number }) => void; frame: () => void; fail: (reason: string) => void; thumb: (dataUrl: string) => void }) {
    if (this.map.has(asset.id)) return;
    const attempt = (this.attempts.get(asset.id) ?? 0) + 1;
    this.attempts.set(asset.id, attempt);
    const v = document.createElement("video");
    v.preload = "auto";
    v.playsInline = true;
    v.muted = true;
    v.disablePictureInPicture = true;
    v.setAttribute("aria-hidden", "true");
    Object.assign(v.style, { position: "absolute", display: "none", left: "0", top: "0", transformOrigin: "center", pointerEvents: "none", objectFit: "fill" } as CSSStyleDeclaration);
    (this.mount ?? document.body).appendChild(v);
    this.map.set(asset.id, v);
    let settled = false;
    let src = "";
    let signed = false;
    let retriedSigned = false;
    const settle = () => { settled = true; const t = this.timers.get(asset.id); if (t) { window.clearTimeout(t); this.timers.delete(asset.id); } };
    const fail = async (timedOut: boolean) => {
      if (settled) return;
      settle();
      on.fail(await diagnose(src, v, timedOut));
    };
    const load = async () => {
      const r = await resolveSrc(asset.url);
      if (!this.map.has(asset.id) || this.map.get(asset.id) !== v) return; // removed meanwhile
      src = r.src; signed = r.signed;
      // Same-origin proxy or the CORS-enabled S3 endpoint: safe to mark anonymous so a poster frame can be drawn.
      if (signed || src.startsWith("/")) v.crossOrigin = "anonymous"; else v.removeAttribute("crossorigin");
      v.src = attempt > 1 && !signed ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src;
    };
    v.addEventListener("loadedmetadata", () => {
      if (settled) return;
      const m = { durationMs: Math.round(v.duration * 1000), width: v.videoWidth, height: v.videoHeight };
      if (!Number.isFinite(m.durationMs) || m.durationMs <= 0) { fail(false); return; }
      settle();
      on.meta(m);
    });
    let fellBack = false;
    v.addEventListener("error", () => {
      // A signed url that fails once (typically expiry after an hour) is re-signed transparently, once;
      // if that fails too (CORS, credentials, anything), the same-origin proxy takes over before
      // the clip is ever marked failed.
      if (signed && !retriedSigned) { retriedSigned = true; load(); return; }
      if (signed && !fellBack) { fellBack = true; signed = false; src = videoSrc(asset.url); v.crossOrigin = "anonymous"; v.src = src; return; }
      if (settled) { on.fail("playback error (the link may have expired; retry)"); return; }
      fail(false);
    });
    v.addEventListener("seeked", on.frame);
    v.addEventListener("loadeddata", on.frame);
    // First decodable frame → a small poster for the Media panel (the only place video pixels are read).
    v.addEventListener("loadeddata", () => {
      try {
        const c = document.createElement("canvas");
        const ar = (v.videoWidth || 9) / (v.videoHeight || 16);
        c.width = 144; c.height = Math.round(144 / ar);
        c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
        on.thumb(c.toDataURL("image/jpeg", 0.72));
      } catch { /* tainted or not ready: no thumbnail */ }
    }, { once: true });
    this.timers.set(asset.id, window.setTimeout(() => fail(true), METADATA_TIMEOUT_MS));
    load();
  }
  remove(assetId: string) {
    const v = this.map.get(assetId);
    if (v) { v.pause(); v.removeAttribute("src"); v.load(); v.remove(); this.map.delete(assetId); }
    const t = this.timers.get(assetId); if (t) { window.clearTimeout(t); this.timers.delete(assetId); }
  }
  /** Shows, positions and syncs every element `wanted` says is on screen; hides and pauses the rest. */
  apply(wanted: Map<string, Want>, forPlayback: boolean, scale: number) {
    for (const [assetId, v] of this.map) {
      const w = wanted.get(assetId);
      if (!w) { if (!v.paused) v.pause(); if (v.style.display !== "none") v.style.display = "none"; continue; }
      const s = v.style;
      s.display = "block";
      s.left = `${w.rect.x * scale}px`; s.top = `${w.rect.y * scale}px`;
      s.width = `${w.rect.w * scale}px`; s.height = `${w.rect.h * scale}px`;
      s.opacity = String(w.opacity);
      const parts: string[] = [];
      if (w.offset) parts.push(`translate(${w.offset.x * scale}px, ${w.offset.y * scale}px)`);
      if (w.rotation) parts.push(`rotate(${w.rotation}deg)`);
      if (w.scaleMul && w.scaleMul !== 1) parts.push(`scale(${w.scaleMul})`);
      s.transform = parts.join(" ");
      s.zIndex = String(w.z);
      v.muted = w.muted;
      v.volume = w.volume;
      if (v.playbackRate !== w.rate) v.playbackRate = w.rate; // pitch is preserved by default (like atempo in the export)
      if (Math.abs(v.currentTime * 1000 - w.sourceMs) > (forPlayback ? SYNC_TOLERANCE_MS * w.rate : 1)) {
        try { v.currentTime = w.sourceMs / 1000; } catch { /* metadata not loaded yet */ }
      }
      if (forPlayback && v.paused) v.play().catch(() => {});
      if (!forPlayback && !v.paused) v.pause();
    }
  }
  pauseAll() { for (const v of this.map.values()) if (!v.paused) v.pause(); }
  dispose() { for (const id of [...this.map.keys()]) this.remove(id); }
}

export function usePlayback(
  doc: EditDocument,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  setDoc: (f: (d: EditDocument) => EditDocument) => void,
  opts: { mountRef: React.RefObject<HTMLDivElement | null>; display: Display; chromeRef?: React.RefObject<OverlayChrome | null> },
) {
  const { mountRef, chromeRef } = opts;
  const [tMs, setT] = useState<Ms>(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<Record<string, AssetStatus>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const pool = useRef<VideoPool | null>(null);
  const docRef = useRef(doc);
  const displayRef = useRef(opts.display);
  const tRef = useRef(0);
  const playingRef = useRef(false);
  const raf = useRef(0);
  const vfc = useRef<{ v: VideoWithVFC; id: number } | null>(null);
  const watchdog = useRef(0);
  const lastPaint = useRef<{ key: string; doc: EditDocument | null; w: number; h: number }>({ key: "", doc: null, w: 0, h: 0 });
  const durationMs = documentDurationMs(doc);

  useEffect(() => { docRef.current = doc; }, [doc]);
  useEffect(() => { displayRef.current = opts.display; }, [opts.display]);

  const getPool = useCallback(() => (pool.current ??= new VideoPool()), []);
  const videoFor = useCallback((assetId: string) => getPool().get(assetId), [getPool]);
  useEffect(() => { getPool().setMount(mountRef.current); });

  /** Repaints the transparent overlay (captions + text) at the playhead, unless nothing it would
   *  paint has changed since the last paint. */
  const paint = useCallback((force = false) => {
    const c = canvasRef.current;
    if (!c) return;
    const d = docRef.current, t = tRef.current, disp = displayRef.current;
    const chrome = chromeRef?.current ?? null;
    const key = overlayKey(d, t) + (chrome ? `#${chrome.key()}` : "");
    const lp = lastPaint.current;
    if (!force && lp.key === key && lp.doc === d && lp.w === disp.w && lp.h === disp.h) return;
    lastPaint.current = { key, doc: d, w: disp.w, h: disp.h };
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const sx = c.width / d.canvas.width, sy = c.height / d.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    drawOverlay(ctx, d, t);
    if (chrome) chrome.draw(ctx, d, t);
  }, [canvasRef, chromeRef]);

  const probe = useCallback((a: Asset) => {
    getPool().ensure(a, {
      meta: (meta) => {
        setDoc((d) => applyAssetMetadata(d, a.id, meta));
        setStatus((s) => ({ ...s, [a.id]: { state: "ready" } }));
      },
      fail: (reason) => setStatus((s) => ({ ...s, [a.id]: { state: "failed", reason } })),
      frame: () => { if (!playingRef.current) paint(); },
      thumb: (dataUrl) => setThumbs((t) => ({ ...t, [a.id]: dataUrl })),
    });
  }, [getPool, setDoc, paint]);

  // One element per asset; read its metadata into the document.
  useEffect(() => {
    const p = getPool();
    for (const a of doc.assets) if (a.kind === "video" && !p.has(a.id)) probe(a);
  }, [doc.assets, probe, getPool]);

  // Drop elements for assets that left the document (stale status entries are harmless).
  useEffect(() => {
    const ids = new Set(doc.assets.map((a) => a.id));
    for (const id of getPool().ids()) if (!ids.has(id)) getPool().remove(id);
  }, [doc.assets, getPool]);

  useEffect(() => () => { pool.current?.dispose(); pool.current = null; }, []);

  /** Re-probes one asset with a fresh element (and a fresh signed url). */
  const retryAsset = useCallback((assetId: string) => {
    const a = docRef.current.assets.find((x) => x.id === assetId);
    if (!a) return;
    getPool().remove(assetId);
    setStatus((s) => { const n = { ...s }; delete n[assetId]; return n; }); // back to the derived "loading"
    probe(a);
  }, [getPool, probe]);

  /** What every asset's element should be doing at `t`: the main clip under the playhead and any
   *  b-roll clips covering it, each with its on-canvas rectangle (same fit rule as the export). */
  const wantedAt = useCallback((t: Ms): Map<string, Want> => {
    const d = docRef.current;
    const wanted = new Map<string, Want>();
    const rectFor = (clip: { assetId: string; transform: { x: number; y: number; scale: number; rotation: number; opacity: number } }) => {
      const a = d.assets.find((x) => x.id === clip.assetId);
      const v = getPool().get(clip.assetId);
      return clipRect(clip as Parameters<typeof clipRect>[0], { width: v?.videoWidth || a?.width || d.canvas.width, height: v?.videoHeight || a?.height || d.canvas.height }, d.canvas);
    };
    const main = clipAt(mainTrack(d), t);
    if (main) wanted.set(main.clip.assetId, { sourceMs: main.sourceMs, muted: main.clip.muted, volume: main.clip.volume, rect: rectFor(main.clip), rotation: main.clip.transform.rotation, opacity: main.clip.transform.opacity, z: 0, rate: main.clip.speed });
    // A transition in progress: the outgoing clip keeps playing underneath (or above, for a slide)
    // with the effect's opacity, offset and scale. The canvas preview of what xfade will render.
    const tr = transitionAt(mainTrack(d), t);
    if (tr && main && tr.into.id === main.clip.id && tr.out.assetId !== tr.into.assetId) {
      const p = tr.progress, W = d.canvas.width, H = d.canvas.height;
      const outWant: Want = { sourceMs: sourceAt(tr.out, t), muted: true, volume: 0, rect: rectFor(tr.out), rotation: tr.out.transform.rotation, opacity: tr.out.transform.opacity, z: 0, rate: tr.out.speed };
      const inWant = wanted.get(main.clip.assetId)!;
      switch (tr.transition.type) {
        case "fade": inWant.opacity *= p; inWant.z = 1; break;
        case "fadeblack": outWant.opacity *= Math.max(0, 1 - p * 2); inWant.opacity *= Math.max(0, p * 2 - 1); inWant.z = 1; break;
        case "slideleft": outWant.offset = { x: -p * W, y: 0 }; inWant.offset = { x: (1 - p) * W, y: 0 }; inWant.z = 1; break;
        case "slideright": outWant.offset = { x: p * W, y: 0 }; inWant.offset = { x: -(1 - p) * W, y: 0 }; inWant.z = 1; break;
        case "slideup": outWant.offset = { x: 0, y: -p * H }; inWant.offset = { x: 0, y: (1 - p) * H }; inWant.z = 1; break;
        case "slidedown": outWant.offset = { x: 0, y: p * H }; inWant.offset = { x: 0, y: -(1 - p) * H }; inWant.z = 1; break;
        case "zoomin": outWant.scaleMul = 1 + 0.5 * p; outWant.opacity *= 1 - p; inWant.z = 1; break;
      }
      wanted.set(tr.out.assetId, outWant);
    }
    const ov = overlayTrack(d);
    if (ov) ov.clips.forEach((c, i) => {
      if (t >= c.at && t < c.at + clipLengthMs(c) && !wanted.has(c.assetId)) wanted.set(c.assetId, { sourceMs: sourceAt(c, t), muted: true, volume: 0, rect: rectFor(c), rotation: c.transform.rotation, opacity: c.transform.opacity, z: 1 + i, rate: c.speed });
    });
    return wanted;
  }, [getPool]);

  const position = useCallback((t: Ms, forPlayback: boolean) => {
    const d = docRef.current, disp = displayRef.current;
    getPool().apply(wantedAt(t), forPlayback, disp.w > 0 ? disp.w / d.canvas.width : 0);
  }, [getPool, wantedAt]);

  const seek = useCallback((t: Ms) => {
    const clamped = Math.max(0, Math.min(documentDurationMs(docRef.current), Math.round(t)));
    tRef.current = clamped;
    setT(clamped);
    position(clamped, playingRef.current);
    paint();
  }, [position, paint]);

  const stopTick = useCallback(() => {
    cancelAnimationFrame(raf.current);
    window.clearTimeout(watchdog.current);
    if (vfc.current) { vfc.current.v.cancelVideoFrameCallback?.(vfc.current.id); vfc.current = null; }
  }, []);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    stopTick();
    getPool().pauseAll();
    paint();
  }, [paint, getPool, stopTick]);

  const play = useCallback(() => {
    const d = docRef.current;
    const total = documentDurationMs(d);
    if (total <= 0) return;
    if (tRef.current >= total) { tRef.current = 0; setT(0); }
    playingRef.current = true;
    setPlaying(true);
    position(tRef.current, true);
    // One tick per decoded frame of the active clip (requestVideoFrameCallback), else per display
    // frame. Either way the playhead comes from the video's own presentation time.
    const tick = (mediaTimeS: number | null) => {
      if (!playingRef.current) return;
      stopTick(); // exactly one pending callback at any time
      const dd = docRef.current;
      const main = clipAt(mainTrack(dd), tRef.current);
      if (!main) { pause(); return; }
      const v = getPool().get(main.clip.assetId) as VideoWithVFC | null;
      let t = tRef.current;
      if (v && v.readyState >= 2) {
        const nowS = mediaTimeS ?? v.currentTime;
        t = main.clip.at + (nowS * 1000 - main.clip.inMs) / main.clip.speed;
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
      schedule();
    };
    const schedule = () => {
      const dd = docRef.current;
      const main = clipAt(mainTrack(dd), tRef.current);
      const v = main ? (getPool().get(main.clip.assetId) as VideoWithVFC | null) : null;
      if (v && v.requestVideoFrameCallback && v.readyState >= 2 && !v.paused) {
        const id = v.requestVideoFrameCallback((_now, meta) => { vfc.current = null; tick(meta.mediaTime); });
        vfc.current = { v, id };
        // Watchdog: while the element is buffering no frame callback fires. Re-check a few times a
        // second (not every display frame) so the clock and the UI stay consistent without piling
        // up callbacks.
        watchdog.current = window.setTimeout(() => { if (playingRef.current && vfc.current?.v === v) tick(null); }, 250);
      } else {
        raf.current = requestAnimationFrame(() => tick(null));
      }
    };
    schedule();
  }, [position, paint, pause, getPool]);

  // Reposition and repaint whenever the document or the display size changes while paused.
  useEffect(() => { if (!playingRef.current) { position(tRef.current, false); paint(); } }, [doc, opts.display, position, paint]);

  const toggle = useCallback(() => (playingRef.current ? pause() : play()), [pause, play]);

  return { tMs, playing, durationMs, status, thumbs, retryAsset, seek, play, pause, toggle, paint, videoFor };
}
