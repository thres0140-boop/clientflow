"use client";
import { videoSrc, imgSrc } from "@/shared/media/videoSrc";
import { ReelDetailPanel, type IGReel } from "@/features/instagram/pages/InstagramPage";

import { useCallback, useEffect, useRef, useState, Component, ReactNode, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { Client } from "@/shared/types";
import { useLiveTheme } from "@/shared/useLiveTheme";

// Catches any render crash from the board (Excalidraw) and shows the REAL error instead of
// the browser's blank "page couldn't load" screen, so we can see what's actually wrong.
class BoardErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 flex items-center justify-center p-6 bg-surface-2">
          <div className="max-w-lg w-full bg-surface border border-danger-200 rounded-2xl p-5 shadow">
            <p className="text-sm font-bold text-danger-600 mb-1">The board hit an error</p>
            <p className="text-xs text-ink-500 mb-3">Your content is safe in the database. Here&apos;s the actual error (screenshot this for support):</p>
            <pre className="text-[11px] text-ink-700 bg-surface-3 rounded-lg p-3 whitespace-pre-wrap break-words max-h-60 overflow-auto">{String(this.state.error?.message || this.state.error)}{"\n\n"}{String(this.state.error?.stack || "").slice(0, 800)}</pre>
            <button onClick={() => location.reload()} className="mt-3 px-4 py-2 text-sm font-semibold text-on-accent bg-accent-600 rounded-lg hover:bg-accent-700">Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalApi = any;

type VideoItem = { key: string; label: string; sub?: string; thumb?: string | null; src?: string; reelId?: string };

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw),
  { ssr: false, loading: () => <BoardSkeleton /> }
);

type Props = {
  clients: Client[];
  selectedClientId: number | null;
  sidebarCollapsed?: boolean;
  embedded?: boolean; // rendered inside a split-view pane (positioned relative to the pane)
};

export default function BoardPage({ clients, selectedClientId, sidebarCollapsed = false, embedded = false }: Props) {
  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  // Embedded: the pane itself is the positioning context, so no sidebar offset.
  const leftOffset = embedded ? 0 : (sidebarCollapsed ? 0 : 280);

  if (!client) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-ink-400 text-sm transition-[left] duration-200" style={{ left: leftOffset }}>
        Select a client to open their board
      </div>
    );
  }

  return <BoardCanvas key={client.id} client={client} leftOffset={leftOffset} />;
}

function BoardCanvas({ client, leftOffset }: { client: Client; leftOffset: number }) {
  const apiRef = useRef<ExcalApi | null>(null);
  const liveTheme = useLiveTheme();
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Last snapped size of each video tile — lets us lock resizing to the 9:16 reel aspect ratio.
  const snapDims = useRef<Record<string, { w: number; h: number }>>({});
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "">("");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Video tiles are NATIVE rectangles (in customData) — a real <video> is layered on top of
  // each, positioned from the live canvas transform. No iframe/embeddable anywhere.
  const [tiles, setTiles] = useState<{ id: string; x: number; y: number; width: number; height: number; url: string; reelId?: number | null; permalink?: string | null; thumbnail?: string | null; handle?: string | null; date?: string | null; views?: number | null; likes?: number | null; comments?: number | null }[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [view, setView] = useState<any>(null);
  const lastSig = useRef<string>("");
  const [ready, setReady] = useState(false);
  const drained = useRef(false);
  const [detailTile, setDetailTile] = useState<{ url: string; reelId?: number | null; permalink?: string | null; thumbnail?: string | null; handle?: string | null; date?: string | null; views?: number | null; likes?: number | null; comments?: number | null } | null>(null);

  const syncTiles = useCallback((elements: any[], appState: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const vids = (elements || [])
      .filter((e: any) => e && !e.isDeleted && e.customData?.video?.url) // eslint-disable-line @typescript-eslint/no-explicit-any
      .map((e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const v = e.customData.video;
        return { id: e.id, x: e.x, y: e.y, width: e.width, height: e.height, url: v.url as string,
          reelId: v.reelId ?? null, permalink: v.permalink ?? null,
          thumbnail: v.thumbnail ?? null, handle: v.handle ?? null, date: v.date ?? null,
          views: v.views ?? null, likes: v.likes ?? null, comments: v.comments ?? null };
      });
    const a = appState || {};
    // Only update React state when the tiles OR the view transform actually change. Excalidraw
    // fires onChange on every render; setState-ing unconditionally re-triggers it → infinite
    // loop (React #185). This signature guard breaks that loop.
    const sig = JSON.stringify({ v: vids, z: a.zoom?.value, sx: a.scrollX, sy: a.scrollY, ox: a.offsetLeft, oy: a.offsetTop });
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    setTiles(vids);
    setView(appState);
  }, []);

  // Drop a video onto the board: a native rectangle whose customData holds the playable URL.
  const addVideo = useCallback(async (item: VideoItem, meta?: Record<string, unknown>, dropAt?: { clientX: number; clientY: number }) => {
    const api = apiRef.current;
    if (!api) return;
    setPickerOpen(false);

    // Resolve a direct, public playable URL (R2/Cloudinary direct; ephemeral via proxy).
    let url: string;
    if (item.reelId) {
      // Capture-once resolver (same as the IG player): our permanent R2 copy if we have one,
      // else capture it now, else a short-lived fallback. Retry once for a just-scraped reel.
      let resolved: string | null = null;
      for (let attempt = 0; attempt < 2 && !resolved; attempt++) {
        try {
          const d = await fetch(`/api/competitors/reel-media?id=${encodeURIComponent(item.reelId)}${attempt ? "&refresh=1" : ""}`, { cache: "no-store" }).then((r) => r.json());
          resolved = d?.url || null;
        } catch { /* retry */ }
      }
      if (!resolved) { alert("This reel is still being saved — it'll be ready in a few minutes. (Freshly-added competitors take a moment to cache.) Try again shortly."); return; }
      // Always proxy — even "permanent" R2 (r2.dev) urls are rate-limited by Cloudflare for
      // direct browser hits, so serve them through our proxy too.
      url = videoSrc(resolved).startsWith("/api/") ? `${window.location.origin}${videoSrc(resolved)}` : resolved;
    } else if (item.src) {
      url = item.src;
    } else {
      return;
    }

    const mod = await import("@excalidraw/excalidraw");
    const w = 270, h = 480;
    let x = 100, y = 100;
    try {
      const st = api.getAppState();
      const zoom = (st.zoom && st.zoom.value) || 1;
      const vw = st.width || window.innerWidth;
      const vh = st.height || window.innerHeight;
      if (dropAt && Number.isFinite(st.scrollX) && Number.isFinite(st.scrollY)) {
        // Place the tile where it was dropped (convert viewport point → scene coords).
        x = (dropAt.clientX - (st.offsetLeft || 0)) / zoom - st.scrollX - w / 2;
        y = (dropAt.clientY - (st.offsetTop || 0)) / zoom - st.scrollY - h / 2;
      } else if (Number.isFinite(st.scrollX) && Number.isFinite(st.scrollY)) {
        x = vw / 2 / zoom - st.scrollX - w / 2;
        y = vh / 2 / zoom - st.scrollY - h / 2;
      }
    } catch { /* use fallback */ }
    const els = mod.convertToExcalidrawElements([
      { type: "rectangle", x, y, width: w, height: h, strokeColor: "#6366f1", backgroundColor: "#0f1c34", roundness: { type: 3 } } as never,
    ]);
    // Carry the playable URL + reel metadata on the element so the overlay tile can render the
    // poster/handle/date/stats (like the Instagram card) and it all persists in the snapshot.
    const videoData: Record<string, unknown> = { url };
    if (meta) {
      for (const k of ["reelId", "permalink", "thumbnail", "handle", "date", "views", "likes", "comments"]) {
        if (meta[k] != null) videoData[k] = meta[k];
      }
    }
    (els[0] as { customData?: unknown }).customData = { video: videoData };
    api.updateScene({ elements: [...api.getSceneElements(), ...els] });
    syncTiles(api.getSceneElements(), api.getAppState());
  }, [syncTiles]);

  // Materialize any videos queued from elsewhere (e.g. "Add to Strategy Board" on the IG tab).
  // Done client-side so tiles are built by Excalidraw's own converter — never a hand-made
  // element that can crash the canvas. Waits for the initial scene to load, drains once.
  useEffect(() => {
    if (!ready || drained.current) return;
    drained.current = true;
    const t = setTimeout(async () => {
      try {
        const { videos } = await fetch(`/api/board/pending?clientId=${client.id}`).then((r) => r.json());
        for (const v of (videos || [])) {
          // Back-compat: older queue entries were bare url strings.
          const item = typeof v === "string" ? { url: v } : v;
          if (item?.url) await addVideo({ key: item.url, label: "", src: item.url }, item);
        }
      } catch { /* ignore */ }
    }, 1200);
    return () => clearTimeout(t);
  }, [ready, client.id, addVideo]);

  const getInitialData = useCallback(async () => {
    try {
      const res = await fetch(`/api/board?clientId=${client.id}`);
      const { snapshot } = await res.json();
      if (snapshot && snapshot !== "{}") {
        const data = JSON.parse(snapshot);
        // Load ONLY the content (elements + files). Deliberately DROP the saved appState/view
        // — a corrupted view (NaN/null zoom or scroll, bad collaborators) crashes Excalidraw
        // on load. Resetting pan/zoom is a tiny cost vs a board that won't open. Also drop any
        // element with non-finite coords (defensive).
        const elements = Array.isArray(data.elements)
          ? data.elements.filter((e: any) => e && [e.x, e.y, e.width, e.height].every((n: any) => typeof n === "number" && Number.isFinite(n))) // eslint-disable-line @typescript-eslint/no-explicit-any
          : [];
        // Restore only the SAFE view settings (background) — NOT the crash-prone scroll/zoom
        // values, and NOT the theme: the board follows the app theme via the `theme` prop.
        const a = data.appState || {};
        const appState: Record<string, unknown> = {};
        if (a.viewBackgroundColor) appState.viewBackgroundColor = a.viewBackgroundColor;
        return { elements, appState, files: data.files || undefined };
      }
    } catch {
      // fresh board
    }
    return null;
  }, [client.id]);

  // Debounced: once resizing stops, snap each video tile to 9:16 in a single clean update.
  const scheduleRatioSnap = useCallback(() => {
    const RATIO = 16 / 9; // height / width for a 9:16 portrait reel
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      const api = apiRef.current;
      if (!api) return;
      const els = api.getSceneElements() as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      let changed = false;
      const corrected = els.map((e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!e || e.isDeleted || !e.customData?.video?.url) return e;
        const w = e.width, h = e.height;
        const prev = snapDims.current[e.id];
        let nw = w, nh = h;
        if (!prev) {
          nh = Math.round(w * RATIO); // first sight — normalise off the width
        } else {
          const dw = Math.abs(w - prev.w), dh = Math.abs(h - prev.h);
          if (dw >= dh) nh = Math.round(w * RATIO); else nw = Math.round(h / RATIO);
        }
        if (Math.abs(nw - w) > 1 || Math.abs(nh - h) > 1) { changed = true; snapDims.current[e.id] = { w: nw, h: nh }; return { ...e, width: nw, height: nh }; }
        snapDims.current[e.id] = { w, h };
        return e;
      });
      if (changed) api.updateScene({ elements: corrected });
    }, 180);
  }, []);

  const handleChange = useCallback((elements: unknown, appState: unknown, files: unknown) => {
    // Snap video tiles back to the 9:16 reel ratio — but only AFTER resizing settles, so we
    // never fight Excalidraw's live resize (that caused the flicker). Debounced: the timer
    // keeps resetting while you drag, then fires once when you let go.
    scheduleRatioSnap();

    // Keep the overlay videos locked to their tiles as the board pans/zooms/moves.
    syncTiles(elements as any[], appState as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    setSaveState("saving");
    saveTimeout.current = setTimeout(async () => {
      try {
        const snapshot = {
          elements,
          appState: { ...(appState as Record<string, unknown>), collaborators: [] },
          files,
        };
        await fetch("/api/board", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: client.id, snapshot: JSON.stringify(snapshot) }),
        });
        setSaveState("saved");
        setTimeout(() => setSaveState(""), 2000);
      } catch {
        setSaveState("");
      }
    }, 1500);
  }, [client.id, syncTiles, scheduleRatioSnap]);

  return (
    <>
      {/* Save indicator */}
      <div className="absolute top-2 right-4 z-20 pointer-events-none">
        <span className={`text-[10px] font-medium transition-opacity ${
          saveState === "saving" ? "text-ink-400 opacity-100"
          : saveState === "saved" ? "text-ok-600 opacity-100"
          : "opacity-0"
        }`}>
          {saveState === "saving" ? "Saving…" : "✓ Saved"}
        </span>
      </div>

      {/* Add-video button — sits to the right of Excalidraw's hamburger menu so it
          doesn't cover it. */}
      <button
        onClick={() => setPickerOpen(true)}
        className="absolute top-2.5 z-20 flex items-center gap-1.5 bg-accent-600 hover:bg-accent-700 text-on-accent text-xs font-semibold px-3 py-1.5 rounded-lg shadow"
        style={{ left: leftOffset + 64 }}
      >
        🎬 Add video
      </button>

      {/* Full canvas — fills everything right of the sidebar */}
      <div className="absolute inset-0 top-0 bottom-0 right-0 transition-[left] duration-200" style={{ left: leftOffset }}
        onDragOverCapture={(e) => { if (e.dataTransfer.types.includes("application/x-ordo-reel")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
        onDropCapture={(e) => {
          if (!e.dataTransfer.types.includes("application/x-ordo-reel")) return; // let Excalidraw handle file/image drops
          const raw = e.dataTransfer.getData("application/x-ordo-reel") || e.dataTransfer.getData("text/plain");
          if (!raw) return;
          let p: any; // eslint-disable-line @typescript-eslint/no-explicit-any
          try { p = JSON.parse(raw); } catch { return; }
          if (!p || p.type !== "ordo-reel") return;
          e.preventDefault();
          e.stopPropagation();
          addVideo(
            { key: `r${p.reelId}`, label: "", reelId: p.reelId != null ? String(p.reelId) : undefined },
            { reelId: p.reelId ?? null, permalink: p.permalink ?? null, thumbnail: p.thumbnail ?? null, handle: p.handle ?? null, date: p.date ?? null, views: p.views ?? null, likes: p.likes ?? null, comments: p.comments ?? null },
            { clientX: e.clientX, clientY: e.clientY },
          );
        }}>
        <BoardErrorBoundary>
        <Excalidraw
          excalidrawAPI={(api) => { apiRef.current = api; setReady(true); }}
          initialData={getInitialData}
          onChange={handleChange}
          // Follows the app theme (the live data-theme attribute, so an unsaved preview in
          // Settings is mirrored too). The in-canvas toggle is off: the theme is one app-wide
          // owner setting, and a member/client session must never be able to switch the
          // board dark from inside the canvas.
          theme={liveTheme}
          UIOptions={{
            canvasActions: {
              toggleTheme: false,
              saveToActiveFile: false,
              saveAsImage: true,
            },
          }}
        />
        </BoardErrorBoundary>
      </div>

      {/* Real <video> elements layered on top of their board tiles, locked to the live
          canvas transform. pointer-events:none container so the board stays fully draggable;
          only the play/pause control captures clicks. */}
      {view && (
        // Clip the overlay to the board canvas's own rect so tiles can never spill over an
        // adjacent split pane (e.g. the Instagram tab). Tiles are positioned relative to this
        // (offset) container, which sits exactly over the canvas.
        <div className="fixed z-10 pointer-events-none overflow-hidden" style={{ left: view.offsetLeft || 0, top: view.offsetTop || 0, width: view.width ?? "100%", height: view.height ?? "100%" }}>
          {tiles.map((t) => {
            const zoom = view.zoom?.value || 1;
            const left = (t.x + (view.scrollX || 0)) * zoom;
            const top = (t.y + (view.scrollY || 0)) * zoom;
            return <VideoTile key={t.id} url={t.url} left={left} top={top} width={t.width * zoom} height={t.height * zoom}
              thumbnail={t.thumbnail} handle={t.handle} date={t.date} views={t.views} likes={t.likes} comments={t.comments}
              onDetails={() => setDetailTile(t)} />;
          })}
        </div>
      )}

      {pickerOpen && <VideoPicker clientId={client.id} onPick={addVideo} onClose={() => setPickerOpen(false)} />}
      {detailTile && <BoardReelDetail tile={detailTile} client={client} onClose={() => setDetailTile(null)} />}
    </>
  );
}

// The "Details" sidebar for a board video tile. When the tile carries a reel id we render the
// EXACT same panel as the Instagram tab (play, analytics, transcript + translate, Send to
// Kanban, Save as Concept/Idea, Link) so the board and IG tab behave identically. Older tiles
// with no reel id fall back to a minimal player.
function BoardReelDetail({ tile, client, onClose }: {
  tile: { url: string; reelId?: number | null; permalink?: string | null; thumbnail?: string | null; handle?: string | null; date?: string | null; views?: number | null; likes?: number | null; comments?: number | null };
  client: Client;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 10); return () => clearTimeout(t); }, []);

  // Reel id present → reuse the real Instagram reel panel (full parity).
  if (tile.reelId) {
    const reel: IGReel = {
      id: String(tile.reelId),
      handle: tile.handle || undefined,
      thumbnail_url: tile.thumbnail || undefined,
      permalink: tile.permalink || undefined,
      timestamp: tile.date || new Date().toISOString(),
      caption: undefined,
      like_count: tile.likes ?? 0,
      comments_count: tile.comments ?? 0,
      plays: tile.views ?? undefined,
    };
    return <ReelDetailPanel reel={reel} client={client} onClose={onClose} />;
  }

  // No reel id (older tile / own upload) → minimal fallback player.
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-end bg-black/40" onClick={onClose}>
      <div className={`w-[460px] max-w-full h-full bg-surface flex flex-col o-elev-pop overflow-hidden transform transition-transform duration-300 ease-out ${mounted ? "translate-x-0" : "translate-x-full"}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line flex-shrink-0">
          <p className="text-sm font-semibold text-ink">{tile.handle ? `@${tile.handle}` : "Reference video"}</p>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-3 text-faint">✕</button>
        </div>
        <div className="relative bg-slate-900 aspect-[9/16] max-h-80 w-full flex items-center justify-center overflow-hidden">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={tile.url} poster={tile.thumbnail ? imgSrc(tile.thumbnail) : undefined} controls autoPlay playsInline className="w-full h-full object-contain" />
        </div>
        <p className="text-xs text-faint text-center px-5 py-4">Re-add this reel from the Instagram tab to unlock analytics, transcript and the Save/Kanban actions.</p>
      </div>
    </div>
  );
}

// A real video locked over its board tile. Container is click-through (so the board stays
// draggable); only the ▶/⏸ button captures clicks. Video loads on first play (light).
function fmtCount(n?: number | null): string {
  if (n == null) return "";
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K" : String(n);
}

function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), sec = Math.floor(t % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function VideoTile({ url, left, top, width, height, thumbnail, handle, date, views, likes, comments, onDetails }:
  { url: string; left: number; top: number; width: number; height: number;
    thumbnail?: string | null; handle?: string | null; date?: string | null; views?: number | null; likes?: number | null; comments?: number | null; onDetails?: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  // The video body is ALWAYS click-through (pointerEvents:none) so the tile can be dragged from
  // anywhere on the canvas. Only the slim control bar + the small buttons capture clicks — so
  // scrubbing and dragging never fight each other.
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const btn = Math.max(30, Math.min(64, width * 0.22));
  const s = Math.max(0.62, Math.min(1.5, width / 270));
  const barH = Math.max(24, 30 * s);
  const chip = (bg: string): CSSProperties => ({
    background: bg, color: "#fff", fontSize: 10 * s, fontWeight: 700, lineHeight: 1,
    padding: `${3 * s}px ${6 * s}px`, borderRadius: 999, backdropFilter: "blur(4px)", whiteSpace: "nowrap",
  });
  function play() { setActive(true); setLoading(true); }
  function togglePlay() { const v = ref.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); }
  function seek(e: React.ChangeEvent<HTMLInputElement>) { const v = ref.current; const t = Number(e.target.value); setCur(t); if (v) v.currentTime = t; }
  const hasMeta = !!(handle || date || views != null || likes != null || comments != null);
  return (
    <div style={{ position: "absolute", left, top, width, height, pointerEvents: "none", borderRadius: 8, overflow: "hidden", background: "#000" }}>
      {/* Poster thumbnail (like the IG card) until the user activates the player */}
      {!active && thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imgSrc(thumbnail)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none" }} />
      )}
      {active && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video ref={ref} src={url} playsInline autoPlay preload="auto" poster={thumbnail ? imgSrc(thumbnail) : undefined}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => { setDur(e.currentTarget.duration || 0); setLoading(false); }}
          onWaiting={() => setLoading(true)} onPlaying={() => setLoading(false)} onCanPlay={() => setLoading(false)}
          onError={(e) => { const v = e.currentTarget; if (!v.src.includes("/api/vid")) { v.src = `${window.location.origin}/api/vid?u=${encodeURIComponent(url)}`; } else { setLoading(false); } }}
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000", pointerEvents: "none" }} />
      )}

      {/* Reel chrome — only in poster mode */}
      {!active && hasMeta && (
        <>
          {handle && <span style={{ position: "absolute", top: 8 * s, left: 8 * s, ...chip("rgba(0,0,0,.5)") }}>@{handle}</span>}
          {date && (
            <span style={{ position: "absolute", top: 8 * s, right: 8 * s, ...chip("rgba(0,0,0,.55)") }}>
              {new Date(date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
            </span>
          )}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,.7), rgba(0,0,0,.05) 45%, transparent)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", left: 8 * s, right: 8 * s, bottom: 8 * s, display: "flex", flexWrap: "wrap", gap: 4 * s }}>
            {views != null && <span style={chip("rgba(61,74,163,.92)")}>▶ {fmtCount(views)}</span>}
            {likes != null && likes > 0 && <span style={chip("rgba(236,72,153,.92)")}>♥ {fmtCount(likes)}</span>}
            {comments != null && comments > 0 && <span style={chip("rgba(71,85,105,.92)")}>💬 {fmtCount(comments)}</span>}
          </div>
        </>
      )}

      {/* Big ▶ in poster mode */}
      {!active && (
        <button onClick={play} aria-label="Play"
          style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: btn, height: btn, borderRadius: "50%", border: 0, background: "rgba(255,255,255,.92)", color: "#0f1c34", display: "flex", alignItems: "center", justifyContent: "center", fontSize: btn * 0.42, cursor: "pointer", pointerEvents: "auto", boxShadow: "0 2px 10px rgba(0,0,0,.4)" }}>▶</button>
      )}

      {/* Buffering spinner */}
      {active && loading && (
        <div style={{ position: "absolute", left: "50%", top: "42%", transform: "translate(-50%,-50%)", pointerEvents: "none" }}>
          <div className="animate-spin" style={{ width: 32, height: 32, borderRadius: "50%", border: "3px solid rgba(255,255,255,.35)", borderTopColor: "#fff" }} />
        </div>
      )}

      {/* Custom control bar — only this slim strip captures clicks, so the rest of the tile
          stays draggable. Play/pause + scrub + time. */}
      {active && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: barH, display: "flex", alignItems: "center", gap: 6 * s, padding: `0 ${7 * s}px`, background: "linear-gradient(to top, rgba(0,0,0,.85), rgba(0,0,0,.25))", pointerEvents: "auto" }}>
          <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}
            style={{ border: 0, background: "transparent", color: "#fff", fontSize: 12 * s, cursor: "pointer", flexShrink: 0, lineHeight: 1 }}>{playing ? "⏸" : "▶"}</button>
          <input type="range" min={0} max={dur || 0} step={0.05} value={Math.min(cur, dur || 0)} onChange={seek} onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, height: 4, accentColor: "#818cf8", cursor: "pointer" }} />
          <span style={{ color: "#fff", fontSize: 8.5 * s, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}>{fmtTime(cur)} / {fmtTime(dur)}</span>
        </div>
      )}

      {/* Details → opens the info sidebar. Always available, top-right. */}
      {onDetails && (
        <button onClick={onDetails} title="Details"
          style={{ position: "absolute", top: 6, right: 6, border: 0, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 10.5 * s, fontWeight: 700, padding: "4px 8px", borderRadius: 999, backdropFilter: "blur(4px)", cursor: "pointer", pointerEvents: "auto", display: "flex", alignItems: "center", gap: 3 }}>ⓘ Details</button>
      )}
    </div>
  );
}

// ─── Video picker ────────────────────────────────────────────────────────────
function VideoPicker({ clientId, onPick, onClose }: { clientId: number; onPick: (v: VideoItem) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"mine" | "competitors">("mine");
  const [mine, setMine] = useState<VideoItem[]>([]);
  const [comp, setComp] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`/api/script-drafts?clientId=${clientId}`).then((r) => r.json()).catch(() => []),
      fetch(`/api/competitors/reels?clientId=${clientId}`).then((r) => r.json()).catch(() => ({ reels: [] })),
    ]).then(([drafts, reelsResp]) => {
      if (cancelled) return;
      const mineItems: VideoItem[] = (Array.isArray(drafts) ? drafts : [])
        .filter((d: any) => d.editedVideoUrl)
        .map((d: any) => ({
          key: `d${d.id}`,
          label: d.title || "Untitled",
          sub: d.concept?.name || d.weekLabel || "",
          thumb: null,
          src: d.editedVideoUrl as string,
        }));
      const reels = Array.isArray(reelsResp?.reels) ? reelsResp.reels : [];
      const compItems: VideoItem[] = reels.map((r: any) => ({
        key: `r${r.id}`,
        label: r.handle ? `@${r.handle}` : "Reel",
        sub: r.caption ? String(r.caption).slice(0, 60) : "",
        thumb: r.thumbnail_url || null,
        reelId: String(r.id),
      }));
      setMine(mineItems);
      setComp(compItems);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [clientId]);

  const items = tab === "mine" ? mine : comp;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-line-soft flex items-center justify-between">
          <h2 className="text-base font-bold text-ink-800">Add a video to the board</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-600 text-xl leading-none">×</button>
        </div>
        <div className="px-5 pt-3 flex gap-2">
          {([["mine", "📹 My videos"], ["competitors", "🔍 Competitor reels"]] as [typeof tab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${tab === id ? "bg-accent-600 text-on-accent" : "bg-surface-3 text-ink-600 hover:bg-surface-4"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="p-5 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : items.length === 0 ? (
            <p className="text-sm text-ink-400 text-center py-8">
              {tab === "mine" ? "No finished videos yet." : "No competitor reels yet — track competitors first."}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {items.map((it) => (
                <button key={it.key} onClick={() => onPick(it)}
                  className="text-left bg-surface-2 border border-line-hard rounded-xl overflow-hidden hover:border-accent-400 hover:shadow transition-all">
                  <div className="aspect-[9/16] bg-slate-900 flex items-center justify-center">
                    {it.thumb
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={imgSrc(it.thumb)} alt="" className="w-full h-full object-cover" />
                      : <span className="text-2xl opacity-40">🎬</span>}
                  </div>
                  <div className="p-2">
                    <p className="text-[11px] font-semibold text-ink-700 truncate">{it.label}</p>
                    {it.sub && <p className="text-[10px] text-ink-400 truncate">{it.sub}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    // Rendered inside the canvas container, which already carries the sidebar offset.
    <div className="absolute inset-0 flex items-center justify-center bg-board-loading">
      <div className="flex flex-col items-center gap-3 text-ink-400">
        <div className="w-8 h-8 border-2 border-line-harder border-t-indigo-500 rounded-full animate-spin" />
        <p className="text-sm">Loading board…</p>
      </div>
    </div>
  );
}
