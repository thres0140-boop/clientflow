"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Client } from "@/lib/types";

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
  const [playOverlay, setPlayOverlay] = useState<string | null>(null);

  // Drop a video onto the board as a NATIVE element (a labeled box with a link) — never an
  // iframe/embeddable, which crashes the webview. Clicking the box's link plays the video
  // in an in-app overlay (see onLinkOpen below). Placed at the centre of the current view.
  const addVideo = useCallback(async (item: VideoItem) => {
    const api = apiRef.current;
    if (!api) return;
    setPickerOpen(false);

    // Resolve the direct, public playable URL here (authenticated app).
    let videoUrl: string;
    if (item.reelId) {
      let resolved: string | null = null;
      let permanent = false;
      try {
        const d = await fetch(`/api/competitors/reel-cache?id=${encodeURIComponent(item.reelId)}`, { method: "POST" }).then((r) => r.json());
        resolved = d?.url || null;
        permanent = !!d?.permanent || !!d?.cached;
      } catch { /* ignore */ }
      if (!resolved) { alert("Couldn't load this reel's video (Instagram link may have expired). Try again."); return; }
      // Permanent R2 copy plays directly; ephemeral goes through the public proxy.
      videoUrl = permanent ? resolved : `${window.location.origin}/api/vid?u=${encodeURIComponent(resolved)}`;
    } else if (item.src) {
      videoUrl = item.src;
    } else {
      return;
    }

    const mod = await import("@excalidraw/excalidraw");
    const w = 240, h = 140;
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
      {
        type: "rectangle", x, y, width: w, height: h,
        strokeColor: "#6366f1", backgroundColor: "#eef2ff", roundness: { type: 3 },
        link: videoUrl,
        label: { text: `▶ ${(item.label || "Video").slice(0, 40)}`, fontSize: 16, strokeColor: "#3730a3" },
      } as never,
    ]);
    api.updateScene({ elements: [...api.getSceneElements(), ...els] });
  }, []);

  const getInitialData = useCallback(async () => {
    try {
      const res = await fetch(`/api/board?clientId=${client.id}`);
      const { snapshot } = await res.json();
      if (snapshot && snapshot !== "{}") {
        return JSON.parse(snapshot);
      }
    } catch {
      // fresh board
    }
    return null;
  }, [client.id]);

  const handleChange = useCallback((elements: unknown, appState: unknown, files: unknown) => {
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
  }, [client.id]);

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
        <Excalidraw
          excalidrawAPI={(api) => { apiRef.current = api; }}
          initialData={getInitialData}
          onChange={handleChange}
          onLinkOpen={(element: { link?: string }, event: { preventDefault?: () => void }) => {
            const link = element?.link || "";
            // Video links open in our in-app overlay; everything else opens normally.
            if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(link) || link.includes("/api/vid") || link.includes("res.cloudinary.com") || link.includes("r2.dev")) {
              event?.preventDefault?.();
              setPlayOverlay(link);
            }
          }}
          UIOptions={{
            canvasActions: {
              toggleTheme: true,
              saveToActiveFile: false,
              saveAsImage: true,
            },
          }}
        />
      </div>

      {pickerOpen && <VideoPicker clientId={client.id} onPick={addVideo} onClose={() => setPickerOpen(false)} />}

      {playOverlay && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4" onClick={() => setPlayOverlay(null)}>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={playOverlay}
              controls autoPlay playsInline
              onError={(e) => {
                const v = e.currentTarget;
                const proxied = `${window.location.origin}/api/vid?u=${encodeURIComponent(playOverlay)}`;
                if (!v.src.includes("/api/vid")) v.src = proxied;
              }}
              className="max-h-[88vh] w-auto max-w-[94vw] rounded-xl bg-black"
            />
            <button onClick={() => setPlayOverlay(null)}
              className="absolute -top-3 -right-3 w-9 h-9 rounded-full bg-white text-slate-800 shadow-lg flex items-center justify-center text-lg hover:bg-slate-100">×</button>
          </div>
        </div>
      )}
    </>
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
