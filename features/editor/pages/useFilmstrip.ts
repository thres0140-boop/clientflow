"use client";

// Filmstrip thumbnails and waveform peaks for the timeline's clip blocks.
//
// Thumbnails come from a SECOND hidden <video> per asset (never the playback element, whose
// currentTime is the clock): a single serial queue seeks it to each sample time, draws the frame
// into a 31x43 canvas and keeps the result as an ImageBitmap, keyed by asset and a 0.5 s grid so
// every zoom level reuses what an earlier one produced. Work runs one seek at a time, off the
// render path (requestIdleCallback where available), and pauses while the preview is playing so
// it never competes with playback decode. Cost: one seek + one small draw per sample, roughly
// 30–100 ms of decoder time each for a 4K source; a 60 s clip at the default zoom needs ~115
// samples, i.e. a few seconds of background work, after which zooming is free.
//
// Peaks come from the server (GET /api/edit-projects/:id/waveform?assetId=): decoding audio in
// the browser would mean fetching the whole 4K file into memory, so ffmpeg extracts 4 kHz mono
// PCM straight from R2 once per asset and the route returns 50 peaks per second, cached in R2.
import { useSyncExternalStore } from "react";
import { resolveSrc } from "./usePlayback";

export const THUMB_W = 31, THUMB_H = 43; // CapCut's filmstrip cell for a 9:16 source
export const WAVE_H = 14;
const GRID_S = 0.5;
const MAX_BITMAPS = 4000;
const SEEK_TIMEOUT_MS = 2500;

type Peaks = { rate: number; peaks: Uint8Array };

class FilmstripStore {
  private bitmaps = new Map<string, ImageBitmap>();
  private pending = new Set<string>();
  private queue: { assetId: string; url: string; t: number }[] = [];
  private videos = new Map<string, { v: HTMLVideoElement; ready: Promise<void> }>();
  private peaks = new Map<string, Peaks | "loading" | "error">();
  private listeners = new Set<() => void>();
  private version = 0;
  private busy = false;
  paused = false;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private notify() { this.version++; for (const fn of this.listeners) fn(); }

  static key(assetId: string, t: number) { return `${assetId}@${(Math.round(t / GRID_S) * GRID_S).toFixed(1)}`; }
  static grid(t: number) { return Math.round(t / GRID_S) * GRID_S; }

  get(assetId: string, t: number): ImageBitmap | null { return this.bitmaps.get(FilmstripStore.key(assetId, t)) ?? null; }

  /** Asks for frames at these source times (seconds); already-known or queued ones are skipped. */
  request(assetId: string, url: string, times: number[]) {
    let added = false;
    for (const t of times) {
      const k = FilmstripStore.key(assetId, t);
      if (this.bitmaps.has(k) || this.pending.has(k)) continue;
      this.pending.add(k);
      this.queue.push({ assetId, url, t: FilmstripStore.grid(t) });
      added = true;
    }
    if (added) this.kick();
  }

  private video(assetId: string, url: string) {
    let e = this.videos.get(assetId);
    if (e) return e;
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true; v.playsInline = true;
    v.style.display = "none";
    document.body.appendChild(v);
    const ready = resolveSrc(url).then(({ src, signed }) => new Promise<void>((resolve, reject) => {
      if (signed || src.startsWith("/")) v.crossOrigin = "anonymous";
      v.src = src;
      v.addEventListener("loadedmetadata", () => resolve(), { once: true });
      v.addEventListener("error", () => reject(new Error("thumb video failed")), { once: true });
    }));
    e = { v, ready };
    this.videos.set(assetId, e);
    return e;
  }

  private kick() {
    if (this.busy || this.paused || this.queue.length === 0) return;
    this.busy = true;
    const job = this.queue.shift()!;
    const run = async () => {
      try {
        const { v, ready } = this.video(job.assetId, job.url);
        await ready;
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); v.removeEventListener("seeked", done); resolve(); };
          const timer = window.setTimeout(done, SEEK_TIMEOUT_MS);
          v.addEventListener("seeked", done);
          v.currentTime = Math.min(job.t, Math.max(0, v.duration - 0.05));
        });
        const c = document.createElement("canvas");
        c.width = THUMB_W; c.height = THUMB_H;
        const ctx = c.getContext("2d")!;
        // cover: scale the frame so it fills the cell, centred
        const s = Math.max(THUMB_W / (v.videoWidth || 1), THUMB_H / (v.videoHeight || 1));
        const w = (v.videoWidth || THUMB_W) * s, h = (v.videoHeight || THUMB_H) * s;
        ctx.drawImage(v, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h);
        const bmp = await createImageBitmap(c);
        if (this.bitmaps.size >= MAX_BITMAPS) { for (const b of this.bitmaps.values()) b.close(); this.bitmaps.clear(); }
        this.bitmaps.set(FilmstripStore.key(job.assetId, job.t), bmp);
        this.notify();
      } catch { /* a frame that cannot be produced stays blank */ }
      finally {
        this.pending.delete(FilmstripStore.key(job.assetId, job.t));
        this.busy = false;
        const next = () => this.kick();
        if ("requestIdleCallback" in window) (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(next);
        else setTimeout(next, 0);
      }
    };
    run();
  }

  setPaused(p: boolean) { this.paused = p; if (!p) this.kick(); }

  /** Waveform peaks for an asset, fetched once; null while loading or unavailable. */
  peaksFor(projectId: number, assetId: string): Peaks | null {
    const cur = this.peaks.get(assetId);
    if (cur && cur !== "loading" && cur !== "error") return cur;
    if (cur) return null;
    this.peaks.set(assetId, "loading");
    fetch(`/api/edit-projects/${projectId}/waveform?assetId=${encodeURIComponent(assetId)}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok || typeof j?.peaks !== "string") throw new Error(j?.error || `HTTP ${r.status}`);
      const bin = atob(j.peaks);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      this.peaks.set(assetId, { rate: Number(j.rate) || 50, peaks: arr });
      this.notify();
    }).catch(() => { this.peaks.set(assetId, "error"); });
    return null;
  }

  forget(assetId: string) {
    const e = this.videos.get(assetId);
    if (e) { e.v.removeAttribute("src"); e.v.load(); e.v.remove(); this.videos.delete(assetId); }
    for (const k of [...this.bitmaps.keys()]) if (k.startsWith(assetId + "@")) { this.bitmaps.get(k)?.close(); this.bitmaps.delete(k); }
    this.peaks.delete(assetId);
  }
}

export const filmstrip = new FilmstripStore();

/** Re-renders the caller whenever a thumbnail or a waveform arrives. */
export function useFilmstripVersion(): number {
  return useSyncExternalStore(filmstrip.subscribe, filmstrip.getVersion, () => 0);
}
