"use client";

import { useEffect, useState } from "react";
import { Client } from "@/lib/types";

type Signal = { level: "red" | "yellow"; label: string };
type ClientCard = {
  id: number; name: string; color: string;
  health: "red" | "yellow" | "green";
  signals: Signal[];
  ideas: number; inStage: number; stageCounts: Record<string, number>;
  stuck: number; awaitingReview: number; scriptsDue: number; upcomingPosts: number;
  lastActivityAt: number | null;
};
type Blocking = { draftId: number; clientId: number; clientName: string; clientColor: string; title: string; stage: string; ageDays: number; concept: string | null };
type Activity = { id: number; clientId: number | null; clientName: string | null; actor: string; type: string; title: string | null; detail: string | null; createdAt: string };
type HQ = {
  summary: { total: number; red: number; yellow: number; green: number };
  clients: ClientCard[];
  blockingMe: Blocking[];
  recent: Activity[];
};

type BrightSpot = { clientId: number; clientName: string; color: string; reelId: string; thumb: string | null; plays: number; ratio: number; permalink: string | null };

const ACTIVITY_ICON: Record<string, string> = {
  script_submitted: "📝", stage_moved: "📋", footage_uploaded: "🎬", accepted: "✅", scheduled: "🗓", posted: "🚀", remixed: "♻️",
};

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function agoMs(ms: number | null): string {
  if (!ms) return "—";
  return ago(new Date(ms).toISOString());
}

const DOT = { red: "bg-red-500", yellow: "bg-amber-400", green: "bg-emerald-500" } as const;
const RING = { red: "border-red-200 bg-red-50/50", yellow: "border-amber-200 bg-amber-50/40", green: "border-slate-200 bg-white" } as const;

export default function HeadquartersPage({ clients, onOpenKanban }: {
  clients: Client[];
  onOpenKanban: (clientId: number, draftId?: number) => void;
}) {
  const [data, setData] = useState<HQ | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bright, setBright] = useState<BrightSpot[]>([]);
  const [brightLoading, setBrightLoading] = useState(true);

  async function load() {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/hq");
      if (res.status === 403) { setError("Headquarters is owner-only."); setData(null); return; }
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Failed to load."); return; }
      setData(d);
    } catch { setError("Failed to load."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // Bright spots — fetch each client's recent reels and flag the ones that beat that
  // client's OWN median (apples-to-apples, never a raw cross-client leaderboard).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBrightLoading(true);
      const found: BrightSpot[] = [];
      await Promise.all((clients || []).filter((c) => !(c as any).isTestAccount).map(async (c) => {
        try {
          const d = await fetch(`/api/instagram/media?clientId=${c.id}`).then((r) => r.json());
          const reels = (d?.reels || []).filter((r: any) => typeof r.plays === "number" && r.plays > 0);
          if (reels.length < 4) return;
          const sorted = [...reels].map((r: any) => r.plays).sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)] || 1;
          for (const r of reels) {
            const ratio = r.plays / median;
            if (ratio >= 2) found.push({ clientId: c.id, clientName: c.name, color: c.color, reelId: r.id, thumb: r.thumbnail_url || null, plays: r.plays, ratio, permalink: r.permalink || null });
          }
        } catch { /* skip client */ }
      }));
      if (cancelled) return;
      found.sort((a, b) => b.ratio - a.ratio);
      setBright(found.slice(0, 8));
      setBrightLoading(false);
    })();
    return () => { cancelled = true; };
  }, [clients]);

  if (loading) return <div className="flex-1 flex items-center justify-center py-32"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (error) return <div className="p-10 text-center text-slate-500">{error}</div>;
  if (!data) return null;

  const { summary, clients: cards, blockingMe, recent } = data;
  const reds = cards.filter((c) => c.health === "red");

  const statusLine = summary.total === 0
    ? "No clients yet."
    : `${summary.total} client${summary.total > 1 ? "s" : ""} · ` +
      (summary.red ? `${summary.red} need${summary.red > 1 ? "" : "s"} you today` : "nothing on fire") +
      `${summary.yellow ? ` · ${summary.yellow} to watch` : ""}` +
      ` · ${summary.green} on track`;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[1280px] mx-auto px-8 py-8">
        {/* Header + status sentence */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">🏛️ Headquarters</h1>
            <p className="text-sm text-slate-500 mt-1">{statusLine}</p>
          </div>
          <button onClick={load} className="px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">↻ Refresh</button>
        </div>

        {/* Summary chips */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-2xl font-bold text-red-600">{summary.red}</p>
            <p className="text-xs font-semibold text-red-700">🔴 Act today</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-2xl font-bold text-amber-600">{summary.yellow}</p>
            <p className="text-xs font-semibold text-amber-700">🟡 Watch</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-2xl font-bold text-emerald-600">{summary.green}</p>
            <p className="text-xs font-semibold text-emerald-700">🟢 On track</p>
          </div>
        </div>

        {summary.red === 0 && (
          <div className="mb-8 rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 text-center">
            <p className="text-sm font-semibold text-emerald-700">✨ All clear — nothing needs you right now.</p>
            <p className="text-xs text-emerald-600 mt-0.5">Check the wins below, or close the tab.</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT: Health board + blocking queue */}
          <div className="lg:col-span-2 space-y-8">
            {/* Blocking-me queue */}
            {blockingMe.length > 0 && (
              <section>
                <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">⏳ Waiting on your review ({blockingMe.length})</h2>
                <div className="space-y-2">
                  {blockingMe.slice(0, 12).map((b) => (
                    <button key={b.draftId} onClick={() => onOpenKanban(b.clientId, b.draftId)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors text-left">
                      <span className="w-2 h-8 rounded-full flex-shrink-0" style={{ backgroundColor: b.clientColor }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 truncate">{b.title}</p>
                        <p className="text-[11px] text-slate-400">{b.clientName}{b.concept ? ` · ${b.concept}` : ""}</p>
                      </div>
                      <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">{b.stage}</span>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">{b.ageDays}d</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Client health board */}
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Client Health</h2>
              <div className="space-y-2">
                {cards.map((c) => (
                  <button key={c.id} onClick={() => onOpenKanban(c.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left hover:shadow-sm ${RING[c.health]}`}>
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT[c.health]}`} />
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0" style={{ backgroundColor: c.color }}>
                      {c.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 truncate">{c.name}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {c.signals.length === 0 ? (
                          <span className="text-[10px] text-emerald-600 font-medium">on track</span>
                        ) : c.signals.map((s, i) => (
                          <span key={i} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${s.level === "red" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{s.label}</span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[10px] text-slate-400">{c.ideas + c.inStage} in pipeline</p>
                      <p className="text-[10px] text-slate-400">{c.upcomingPosts} scheduled · {agoMs(c.lastActivityAt)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* RIGHT: Bright spots + activity */}
          <div className="space-y-8">
            {/* Bright spots */}
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">🟢 Bright spots — overperformers</h2>
              {brightLoading ? (
                <p className="text-xs text-slate-400">Scanning reels…</p>
              ) : bright.length === 0 ? (
                <p className="text-xs text-slate-400">No standout reels right now.</p>
              ) : (
                <div className="space-y-2">
                  {bright.map((b) => (
                    <div key={b.reelId} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50/40">
                      {b.thumb
                        ? <img src={b.thumb} alt="" className="w-10 h-14 rounded-lg object-cover flex-shrink-0" />
                        : <div className="w-10 h-14 rounded-lg bg-slate-200 flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-800 truncate">{b.clientName}</p>
                        <p className="text-[11px] text-emerald-700 font-bold">{b.ratio.toFixed(1)}× their median</p>
                        <p className="text-[10px] text-slate-400">{b.plays >= 1000 ? (b.plays / 1000).toFixed(1) + "K" : b.plays} views</p>
                      </div>
                      <button onClick={() => onOpenKanban(b.clientId)}
                        title="Remix this winner in the client's Kanban"
                        className="px-2 py-1 text-[10px] font-bold text-white bg-purple-600 rounded-lg hover:bg-purple-700 flex-shrink-0">♻️ Remix</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Recent activity digest */}
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Recent activity</h2>
              {recent.length === 0 ? (
                <p className="text-xs text-slate-400">Nothing logged yet — actions will start appearing here.</p>
              ) : (
                <div className="space-y-1.5">
                  {recent.slice(0, 15).map((a) => (
                    <div key={a.id} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5">{ACTIVITY_ICON[a.type] || "•"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-slate-700 leading-snug">
                          <span className="font-semibold">{a.actor}</span>{" "}
                          {a.type === "script_submitted" ? "submitted a script" : a.type === "stage_moved" ? "moved a card" : a.type === "footage_uploaded" ? "uploaded footage" : a.type === "posted" ? "went live" : a.type}
                          {a.clientName ? <span className="text-slate-400"> · {a.clientName}</span> : null}
                        </p>
                        {a.title && <p className="text-[11px] text-slate-400 truncate">{a.title}{a.detail ? ` · ${a.detail}` : ""}</p>}
                      </div>
                      <span className="text-[10px] text-slate-300 flex-shrink-0 whitespace-nowrap">{ago(a.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
