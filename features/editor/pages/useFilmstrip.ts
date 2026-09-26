"use client";

// Filmstrip sprites and waveform peaks for the timeline's clip blocks. Both are made on the server,
// once per asset, and cached in R2:
//   GET /api/edit-projects/:id/filmstrip?assetId=  → { interval, cols, rows, count, cellW, cellH, url }
//     one JPEG sprite of 31×43 keyframe cells, one per `interval` seconds (ffmpeg, keyframes only)
//   GET /api/edit-projects/:id/waveform?assetId=   → { rate, peaks }  50 peak bytes per second
// The browser never decodes video for the timeline: a cell is a drawImage from the sprite. There is
// no client-side sampler any more; the earlier hidden-video approach competed with playback and
// depended on a CORS-enabled read of the clip that the server does not need.
import { useSyncExternalStore } from "react";

export const WAVE_H = 14;

export type Sprite = { img: HTMLImageElement; interval: number; cols: number; count: number; cellW: number; cellH: number };
type Peaks = { rate: number; peaks: Uint8Array };
type Slot<T> = T | "loading" | "error";

class FilmstripStore {
  private sprites = new Map<string, Slot<Sprite>>();
  private peaks = new Map<string, Slot<Peaks>>();
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private notify() { this.version++; for (const fn of this.listeners) fn(); }

  /** The sprite for an asset: fetched once per session; "loading" until the image is in, "error" if it cannot be made. */
  spriteFor(projectId: number, assetId: string): Slot<Sprite> {
    const cur = this.sprites.get(assetId);
    if (cur) return cur;
    this.sprites.set(assetId, "loading");
    fetch(`/api/edit-projects/${projectId}/filmstrip?assetId=${encodeURIComponent(assetId)}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok || typeof j?.url !== "string") throw new Error(j?.error || `HTTP ${r.status}`);
      const img = new Image();
      img.onload = () => { this.sprites.set(assetId, { img, interval: Number(j.interval) || 1, cols: Number(j.cols) || 24, count: Number(j.count) || 1, cellW: Number(j.cellW) || 31, cellH: Number(j.cellH) || 43 }); this.notify(); };
      img.onerror = () => { this.sprites.set(assetId, "error"); this.notify(); };
      img.src = j.url;
    }).catch(() => { this.sprites.set(assetId, "error"); this.notify(); });
    return "loading";
  }

  /** Waveform peaks for an asset; "loading" until fetched, "error" if the route failed. */
  peaksFor(projectId: number, assetId: string): Slot<Peaks> {
    const cur = this.peaks.get(assetId);
    if (cur) return cur;
    this.peaks.set(assetId, "loading");
    fetch(`/api/edit-projects/${projectId}/waveform?assetId=${encodeURIComponent(assetId)}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok || typeof j?.peaks !== "string") throw new Error(j?.error || `HTTP ${r.status}`);
      const bin = atob(j.peaks);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      this.peaks.set(assetId, { rate: Number(j.rate) || 50, peaks: arr });
      this.notify();
    }).catch(() => { this.peaks.set(assetId, "error"); this.notify(); });
    return "loading";
  }

  forget(assetId: string) { this.sprites.delete(assetId); this.peaks.delete(assetId); }
}

export const filmstrip = new FilmstripStore();

/** Re-renders the caller whenever a sprite or a waveform arrives. */
export function useFilmstripVersion(): number {
  return useSyncExternalStore(filmstrip.subscribe, filmstrip.getVersion, () => 0);
}
