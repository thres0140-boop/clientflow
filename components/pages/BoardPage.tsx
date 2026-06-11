"use client";

import { useCallback, useEffect, useRef, useState, Component, ReactNode } from "react";
import dynamic from "next/dynamic";
import { Client } from "@/lib/types";

// Catches any render crash from the board (Excalidraw) and shows the REAL error instead of
// the browser's blank "page couldn't load" screen, so we can see what's actually wrong.
class BoardErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 flex items-center justify-center p-6 bg-slate-50">
          <div className="max-w-lg w-full bg-white border border-red-200 rounded-2xl p-5 shadow">
            <p className="text-sm font-bold text-red-600 mb-1">The board hit an error</p>
            <p className="text-xs text-slate-500 mb-3">Your content is safe in the database. Here&apos;s the actual error (screenshot this for support):</p>
            <pre className="text-[11px] text-slate-700 bg-slate-100 rounded-lg p-3 whitespace-pre-wrap break-words max-h-60 overflow-auto">{String(this.state.error?.message || this.state.error)}{"\n\n"}{String(this.state.error?.stack || "").slice(0, 800)}</pre>
            <button onClick={() => location.reload()} className="mt-3 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">Reload</button>
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
};

export default function BoardPage({ clients, selectedClientId, sidebarCollapsed = false }: Props) {
  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  const leftOffset = sidebarCollapsed ? 0 : 280; // match the (collapsible) sidebar width

  if (!client) {
    return (
      <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm transition-[left] duration-200" style={{ left: leftOffset }}>
        Select a client to open their board
      </div>
    );
  }

  return <BoardCanvas key={client.id} client={client} leftOffset={leftOffset} />;
}

function BoardCanvas({ client, leftOffset }: { client: Client; leftOffset: number }) {
  const apiRef = useRef<ExcalApi | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "">("");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Video tiles are NATIVE rectangles (in customData) — a real <video> is layered on top of
  // each, positioned from the live canvas transform. No iframe/embeddable anywhere.
  const [tiles, setTiles] = useState<{ id: string; x: number; y: number; width: number; height: number; url: string }[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [view, setView] = useState<any>(null);

  const syncTiles = useCallback((elements: any[], appState: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const vids = (elements || [])
      .filter((e: any) => e && !e.isDeleted && e.customData?.video?.url) // eslint-disable-line @typescript-eslint/no-explicit-any
      .map((e: any) => ({ id: e.id, x: e.x, y: e.y, width: e.width, height: e.height, url: e.customData.video.url as string })); // eslint-disable-line @typescript-eslint/no-explicit-any
    setTiles(vids);
    setView(appState);
  }, []);

  // Drop a video onto the board: a native rectangle whose customData holds the playable URL.
  const addVideo = useCallback(async (item: VideoItem) => {
    const api = apiRef.current;
    if (!api) return;
    setPickerOpen(false);

    // Resolve a direct, public playable URL (R2/Cloudinary direct; ephemeral via proxy).
    let url: string;
    if (item.reelId) {
      let resolved: string | null = null;
      let permanent = false;
      try {
        const d = await fetch(`/api/competitors/reel-cache?id=${encodeURIComponent(item.reelId)}`, { method: "POST" }).then((r) => r.json());
        resolved = d?.url || null;
        permanent = !!d?.permanent || !!d?.cached;
      } catch { /* ignore */ }
      if (!resolved) { alert("Couldn't load this reel's video (Instagram link may have expired). Try again."); return; }
      url = permanent ? resolved : `${window.location.origin}/api/vid?u=${encodeURIComponent(resolved)}`;
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
      if (Number.isFinite(st.scrollX) && Number.isFinite(st.scrollY)) {
        x = vw / 2 / zoom - st.scrollX - w / 2;
        y = vh / 2 / zoom - st.scrollY - h / 2;
      }
    } catch { /* use fallback */ }
    const els = mod.convertToExcalidrawElements([
      { type: "rectangle", x, y, width: w, height: h, strokeColor: "#6366f1", backgroundColor: "#0f1c34", roundness: { type: 3 } } as never,
    ]);
    // Carry the playable URL on the element so the overlay <video> can find it + it persists.
    (els[0] as { customData?: unknown }).customData = { video: { url } };
    api.updateScene({ elements: [...api.getSceneElements(), ...els] });
    syncTiles(api.getSceneElements(), api.getAppState());
  }, [syncTiles]);

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
        return { elements, files: data.files || undefined };
      }
    } catch {
      // fresh board
    }
    return null;
  }, [client.id]);

  const handleChange = useCallback((elements: unknown, appState: unknown, files: unknown) => {
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
  }, [client.id, syncTiles]);

  return (
    <>
      {/* Save indicator */}
      <div className="absolute top-2 right-4 z-20 pointer-events-none">
        <span className={`text-[10px] font-medium transition-opacity ${
          saveState === "saving" ? "text-slate-400 opacity-100"
          : saveState === "saved" ? "text-green-600 opacity-100"
          : "opacity-0"
        }`}>
          {saveState === "saving" ? "Saving…" : "✓ Saved"}
        </span>
      </div>

      {/* Add-video button — sits to the right of Excalidraw's hamburger menu so it
          doesn't cover it. */}
      <button
        onClick={() => setPickerOpen(true)}
        className="absolute top-2.5 z-20 flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow"
        style={{ left: leftOffset + 64 }}
      >
        🎬 Add video
      </button>

      {/* Full canvas — fills everything right of the sidebar */}
      <div className="absolute inset-0 top-0 bottom-0 right-0 transition-[left] duration-200" style={{ left: leftOffset }}>
        <BoardErrorBoundary>
        <Excalidraw
          excalidrawAPI={(api) => { apiRef.current = api; }}
          initialData={getInitialData}
          onChange={handleChange}
          UIOptions={{
            canvasActions: {
              toggleTheme: true,
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
        <div className="fixed inset-0 z-10 pointer-events-none overflow-hidden">
          {tiles.map((t) => {
            const zoom = view.zoom?.value || 1;
            const left = (t.x + (view.scrollX || 0)) * zoom + (view.offsetLeft || 0);
            const top = (t.y + (view.scrollY || 0)) * zoom + (view.offsetTop || 0);
            return <VideoTile key={t.id} url={t.url} left={left} top={top} width={t.width * zoom} height={t.height * zoom} />;
          })}
        </div>
      )}

      {pickerOpen && <VideoPicker clientId={client.id} onPick={addVideo} onClose={() => setPickerOpen(false)} />}
    </>
  );
}

// A real video locked over its board tile. Container is click-through (so the board stays
// draggable); only the ▶/⏸ button captures clicks. Video loads on first play (light).
function VideoTile({ url, left, top, width, height }: { url: string; left: number; top: number; width: number; height: number }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const btn = Math.max(26, Math.min(60, width * 0.2));
  function toggle() {
    setStarted(true);
    const v = ref.current;
    if (!v) { setPlaying(true); return; }
    if (v.paused) { v.play().then(() => setPlaying(true)).catch(() => {}); } else { v.pause(); setPlaying(false); }
  }
  return (
    <div style={{ position: "absolute", left, top, width, height, pointerEvents: "none", borderRadius: 8, overflow: "hidden", background: "#000" }}>
      {started && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video ref={ref} src={url} playsInline preload="auto"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onError={(e) => { const v = e.currentTarget; if (!v.src.includes("/api/vid")) v.src = `${window.location.origin}/api/vid?u=${encodeURIComponent(url)}`; }}
          style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
      )}
      {/* Small centre ▶ when not playing (rest of the tile is click-through → draggable) */}
      {!playing && (
        <button onClick={toggle} aria-label="Play"
          style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: btn, height: btn, borderRadius: "50%", border: 0, background: "rgba(255,255,255,.92)", color: "#0f1c34", display: "flex", alignItems: "center", justifyContent: "center", fontSize: btn * 0.42, cursor: "pointer", pointerEvents: "auto", boxShadow: "0 2px 10px rgba(0,0,0,.4)" }}>▶</button>
      )}
      {/* Small ⏸ pill top-right while playing */}
      {playing && (
        <button onClick={toggle} aria-label="Pause"
          style={{ position: "absolute", right: 6, top: 6, width: 26, height: 26, borderRadius: "50%", border: 0, background: "rgba(0,0,0,.55)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, cursor: "pointer", pointerEvents: "auto" }}>⏸</button>
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">Add a video to the board</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="px-5 pt-3 flex gap-2">
          {([["mine", "📹 My videos"], ["competitors", "🔍 Competitor reels"]] as [typeof tab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg ${tab === id ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="p-5 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">
              {tab === "mine" ? "No finished videos yet." : "No competitor reels yet — track competitors first."}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {items.map((it) => (
                <button key={it.key} onClick={() => onPick(it)}
                  className="text-left bg-slate-50 border border-slate-200 rounded-xl overflow-hidden hover:border-indigo-400 hover:shadow transition-all">
                  <div className="aspect-[9/16] bg-slate-900 flex items-center justify-center">
                    {it.thumb
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={it.thumb.includes("/api/img") || it.thumb.includes("r2.dev") ? it.thumb : `/api/img?u=${encodeURIComponent(it.thumb)}`} alt="" className="w-full h-full object-cover" />
                      : <span className="text-2xl opacity-40">🎬</span>}
                  </div>
                  <div className="p-2">
                    <p className="text-[11px] font-semibold text-slate-700 truncate">{it.label}</p>
                    {it.sub && <p className="text-[10px] text-slate-400 truncate">{it.sub}</p>}
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
    <div className="absolute inset-0 left-[280px] flex items-center justify-center bg-[#f8f9fa]">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin" />
        <p className="text-sm">Loading board…</p>
      </div>
    </div>
  );
}
