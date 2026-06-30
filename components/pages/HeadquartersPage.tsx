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
type Totals = { awaitingReview: number; scriptsDue: number; stuck: number; upcomingPosts: number; inPipeline: number };
type HQ = {
  summary: { total: number; red: number; yellow: number; green: number };
  totals: Totals;
  clients: ClientCard[];
  blockingMe: Blocking[];
  recent: Activity[];
  readiness: { windowDays: number; total: number; atCheck: number; byClient: { id: number; name: string; color: string; total: number; atCheck: number; behind: number }[] };
  charts: {
    stageDistribution: { name: string; count: number }[];
    workload: { id: number; name: string; color: string; count: number; health: "red" | "yellow" | "green" }[];
    runway: { id: number; name: string; color: string; runwayDays: number; coveredUntil: string | null; plannedUntil: string | null; plannedRunwayDays: number; scheduled: number; planned: number; inProduction: number }[];
  };
};
type MomRow = { id: number; name: string; color: string; health: "red" | "yellow" | "green" | "gray"; delta?: number | null; curAvg?: number; prevAvg?: number; curCount?: number; prevCount?: number; note?: string };

function fmtK(n?: number): string {
  if (!n) return "0";
  return n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n);
}

const DEFAULT_THR = { runwayRed: 3, runwayYellow: 7, stuckDays: 4, momUp: 10, momDown: 10 };

const ACTIVITY_ICON: Record<string, string> = { script_submitted: "📝", stage_moved: "📋", footage_uploaded: "🎬", accepted: "✅", scheduled: "🗓", posted: "🚀", remixed: "♻️" };

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function agoMs(ms: number | null): string { return ms ? ago(new Date(ms).toISOString()) : "—"; }

const DOT = { red: "bg-red-500", yellow: "bg-amber-400", green: "bg-emerald-500" } as const;
const RING = { red: "border-red-200 bg-red-50/50", yellow: "border-amber-200 bg-amber-50/40", green: "border-slate-200 bg-white" } as const;
const FUNNEL_COLORS = ["#6366f1", "#7c3aed", "#9333ea", "#c026d3", "#db2777", "#e11d48"];

// ── Charts (dependency-free) ───────────────────────────────────────────────
function StageFunnel({ stages }: { stages: { name: string; count: number }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="space-y-2">
      {stages.map((s, i) => (
        <div key={s.name} className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 w-24 text-right flex-shrink-0 truncate">{s.name}</span>
          <div className="flex-1 h-5 bg-slate-100 rounded-md overflow-hidden">
            <div className="h-full rounded-md flex items-center justify-end pr-1.5 text-[10px] font-bold text-white transition-all"
              style={{ width: `${Math.max(8, (s.count / max) * 100)}%`, backgroundColor: FUNNEL_COLORS[i % FUNNEL_COLORS.length] }}>
              {s.count}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkloadBars({ workload, onOpen }: { workload: HQ["charts"]["workload"]; onOpen: (id: number) => void }) {
  const max = Math.max(1, ...workload.map((w) => w.count));
  return (
    <div className="space-y-2">
      {workload.slice(0, 8).map((w) => (
        <button key={w.id} onClick={() => onOpen(w.id)} className="w-full flex items-center gap-2 group">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT[w.health]}`} />
          <span className="text-[11px] text-slate-600 w-20 text-right flex-shrink-0 truncate group-hover:text-slate-900">{w.name}</span>
          <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden">
            <div className="h-full rounded transition-all" style={{ width: `${Math.max(6, (w.count / max) * 100)}%`, backgroundColor: w.color }} />
          </div>
          <span className="text-[11px] font-semibold text-slate-500 w-6 flex-shrink-0">{w.count}</span>
        </button>
      ))}
    </div>
  );
}

function ContentRunway({ rows, onOpen, redDays, yellowDays }: { rows: HQ["charts"]["runway"]; onOpen: (id: number) => void; redDays: number; yellowDays: number }) {
  const max = Math.max(10, ...rows.map((r) => Math.max(r.runwayDays, r.plannedRunwayDays)));
  const fmtDate = (s: string | null) => s ? new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";
  const barColor = (d: number) => d <= 0 ? "#cbd5e1" : d < redDays ? "#ef4444" : d <= yellowDays ? "#f59e0b" : "#10b981";
  const daysColor = (d: number) => d <= 0 ? "text-slate-400" : d < redDays ? "text-red-600" : d <= yellowDays ? "text-amber-600" : "text-emerald-600";
  if (!rows.length) return <p className="text-xs text-slate-400">No clients.</p>;
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const hasPlannedBeyond = r.plannedRunwayDays > r.runwayDays;
        return (
          <button key={r.id} onClick={() => onOpen(r.id)} className="w-full text-left group">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-600 w-16 text-right flex-shrink-0 truncate group-hover:text-slate-900">{r.name}</span>
              <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden relative">
                {/* planned reach (lighter, behind) */}
                <div className="absolute inset-y-0 left-0 rounded bg-slate-300/70" style={{ width: `${Math.min(100, (r.plannedRunwayDays / max) * 100)}%` }} />
                {/* scheduled / locked-in (solid, on top) */}
                <div className="absolute inset-y-0 left-0 rounded transition-all" style={{ width: `${Math.max(r.runwayDays > 0 ? 4 : 0, (r.runwayDays / max) * 100)}%`, backgroundColor: barColor(r.runwayDays) }} />
              </div>
              <span className={`text-[11px] font-bold w-12 text-right flex-shrink-0 ${daysColor(r.runwayDays)}`}>{r.runwayDays > 0 ? `${r.runwayDays}d` : "empty"}</span>
            </div>
            <p className="text-[9px] text-slate-400 ml-[72px] mt-0.5">
              <span className="font-semibold text-slate-500">{r.scheduled} scheduled</span> · until {fmtDate(r.coveredUntil)}
              {hasPlannedBeyond ? <span className="text-slate-400"> · planned to {fmtDate(r.plannedUntil)}</span> : null}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function HealthRing({ red, yellow, green }: { red: number; yellow: number; green: number }) {
  const total = Math.max(1, red + yellow + green);
  const redDeg = (red / total) * 360;
  const yelDeg = ((red + yellow) / total) * 360;
  return (
    <div className="flex items-center gap-4">
      <div className="relative w-24 h-24 flex-shrink-0">
        <div className="w-24 h-24 rounded-full" style={{ background: `conic-gradient(#ef4444 0 ${redDeg}deg, #f59e0b ${redDeg}deg ${yelDeg}deg, #10b981 ${yelDeg}deg 360deg)` }} />
        <div className="absolute inset-[14px] bg-white rounded-full flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-slate-800">{red + yellow + green}</span>
          <span className="text-[9px] text-slate-400 -mt-0.5">clients</span>
        </div>
      </div>
      <div className="space-y-1.5 text-xs">
        <p className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> <span className="font-semibold text-slate-700">{red}</span> <span className="text-slate-400">act today</span></p>
        <p className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> <span className="font-semibold text-slate-700">{yellow}</span> <span className="text-slate-400">watch</span></p>
        <p className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> <span className="font-semibold text-slate-700">{green}</span> <span className="text-slate-400">on track</span></p>
      </div>
    </div>
  );
}

function StatCard({ value, label, tone }: { value: number; label: string; tone: "red" | "amber" | "emerald" | "indigo" | "slate" }) {
  const map = {
    red: "border-red-200 bg-red-50 text-red-600", amber: "border-amber-200 bg-amber-50 text-amber-600",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-600", indigo: "border-indigo-200 bg-indigo-50 text-indigo-600",
    slate: "border-slate-200 bg-white text-slate-600",
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 ${map}`}>
      <p className="text-2xl font-bold leading-none">{value}</p>
      <p className="text-[11px] font-semibold mt-1 opacity-90">{label}</p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function HeadquartersPage({ clients, refreshClients, onOpenKanban }: {
  clients: Client[];
  refreshClients?: () => void;
  onOpenKanban: (clientId: number, draftId?: number) => void;
}) {
  const [data, setData] = useState<HQ | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<"week" | "month">("month");
  const [mom, setMom] = useState<MomRow[]>([]);
  const [momLoading, setMomLoading] = useState(true);
  const [review, setReview] = useState<{ draftId: number; clientId: number } | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readyDays, setReadyDays] = useState(7);
  const [thr, setThr] = useState<typeof DEFAULT_THR>(() => {
    if (typeof window !== "undefined") { try { return { ...DEFAULT_THR, ...JSON.parse(localStorage.getItem("hq_thresholds") || "{}") }; } catch { /* */ } }
    return DEFAULT_THR;
  });
  function setThreshold(key: keyof typeof DEFAULT_THR, val: number) {
    const next = { ...thr, [key]: val };
    setThr(next);
    try { localStorage.setItem("hq_thresholds", JSON.stringify(next)); } catch { /* */ }
  }

  const visibleClients = (clients || []).filter((c) => !(c as any).hideFromHq);

  async function toggleClient(c: Client, hide: boolean) {
    await fetch(`/api/clients/${c.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hideFromHq: hide }) });
    refreshClients?.();
    load();
  }

  async function load() {
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/hq?stuckDays=${thr.stuckDays}&readyDays=${readyDays}`);
      if (res.status === 403) { setError("Headquarters is owner-only."); setData(null); return; }
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Failed to load."); return; }
      setData(d);
    } catch { setError("Failed to load."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [thr.stuckDays, readyDays]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-client momentum — how each client's content is trending vs their own previous period.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMomLoading(true);
      try {
        const d = await fetch(`/api/hq/momentum?period=${period}&up=${thr.momUp}&down=${thr.momDown}`).then((r) => r.json());
        if (!cancelled) setMom(Array.isArray(d?.clients) ? d.clients : []);
      } catch { if (!cancelled) setMom([]); }
      finally { if (!cancelled) setMomLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [period, clients, thr.momUp, thr.momDown]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="flex-1 flex items-center justify-center py-32"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>;
  if (error) return <div className="p-10 text-center text-slate-500">{error}</div>;
  if (!data) return null;

  const { summary, totals, clients: cards, blockingMe, recent, charts } = data;
  const statusLine = summary.total === 0
    ? "No clients yet."
    : `${summary.total} client${summary.total > 1 ? "s" : ""} · ` +
      (summary.red ? `${summary.red} need${summary.red > 1 ? "" : "s"} you today` : "nothing on fire") +
      `${summary.yellow ? ` · ${summary.yellow} to watch` : ""} · ${summary.green} on track`;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50">
      <div className="px-6 lg:px-10 py-7 w-full">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">🏛️ Headquarters</h1>
            <p className="text-sm text-slate-500 mt-1">{statusLine}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setManageOpen((o) => !o)} className="px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">⚙ Clients</button>
              {manageOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setManageOpen(false)} />
                  <div className="absolute right-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-2 max-h-[60vh] overflow-y-auto">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-2 py-1.5">Show in Headquarters</p>
                    {(clients || []).map((c) => {
                      const shown = !(c as any).hideFromHq;
                      return (
                        <label key={c.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                          <input type="checkbox" checked={shown} onChange={(e) => toggleClient(c, !e.target.checked)} className="rounded" />
                          <span className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0" style={{ backgroundColor: c.color }}>{c.name.slice(0, 1).toUpperCase()}</span>
                          <span className={`text-xs truncate ${shown ? "text-slate-700" : "text-slate-400 line-through"}`}>{c.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
            <div className="relative">
              <button onClick={() => setSettingsOpen((o) => !o)} className="px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">⚙ Thresholds</button>
              {settingsOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(false)} />
                  <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3 space-y-3">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Headquarters thresholds</p>
                    {([
                      ["runwayRed", "Runway 🔴 below (days)"],
                      ["runwayYellow", "Runway 🟡 up to (days)"],
                      ["stuckDays", "Draft 'stuck' after (days)"],
                      ["momUp", "Momentum 🟢 up ≥ (%)"],
                      ["momDown", "Momentum 🔴 down ≥ (%)"],
                    ] as [keyof typeof DEFAULT_THR, string][]).map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <label className="text-xs text-slate-600">{label}</label>
                        <input type="number" min={1} value={thr[key]}
                          onChange={(e) => setThreshold(key, Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                      </div>
                    ))}
                    <button onClick={() => { setThr(DEFAULT_THR); try { localStorage.setItem("hq_thresholds", JSON.stringify(DEFAULT_THR)); } catch { /* */ } }}
                      className="w-full text-[11px] font-semibold text-slate-500 hover:text-slate-700 pt-1">Reset to defaults</button>
                  </div>
                </>
              )}
            </div>
            <button onClick={load} className="px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">↻ Refresh</button>
          </div>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
          <StatCard value={summary.red} label="🔴 Act today" tone="red" />
          <StatCard value={summary.yellow} label="🟡 Watch" tone="amber" />
          <StatCard value={summary.green} label="🟢 On track" tone="emerald" />
          <StatCard value={totals.awaitingReview} label="⏳ Awaiting your review" tone="indigo" />
          <StatCard value={totals.scriptsDue} label="📝 Scripts owed" tone="slate" />
          <StatCard value={totals.upcomingPosts} label="🗓 Scheduled (7d)" tone="slate" />
        </div>

        {/* Charts band */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-7">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Pipeline — where the work sits</p>
            <StageFunnel stages={charts.stageDistribution} />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Content runway — how long we're covered</p>
            <div className="flex items-center gap-3 text-[10px] text-slate-400 mb-3">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> scheduled</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-300" /> planned</span>
              <span>· 🔴 &lt;{thr.runwayRed}d · 🟡 ≤{thr.runwayYellow}d</span>
            </div>
            <ContentRunway rows={charts.runway} onOpen={(id) => onOpenKanban(id)} redDays={thr.runwayRed} yellowDays={thr.runwayYellow} />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Client health</p>
            <HealthRing red={summary.red} yellow={summary.yellow} green={summary.green} />
          </div>
        </div>

        {summary.red === 0 && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 text-center">
            <p className="text-sm font-semibold text-emerald-700">✨ All clear — nothing needs you right now.</p>
          </div>
        )}

        {/* Main board: full width 12-col */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Waiting on review */}
          <div className="xl:col-span-4">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">⏳ Waiting on your review ({blockingMe.length})</h2>
            {blockingMe.length === 0 ? (
              <p className="text-xs text-slate-400">Nothing waiting on you 🎉</p>
            ) : (
              <div className="space-y-2">
                {blockingMe.slice(0, 14).map((b) => (
                  <button key={b.draftId} onClick={() => setReview({ draftId: b.draftId, clientId: b.clientId })}
                    title="Open & review here"
                    className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors text-left">
                    <span className="w-1.5 h-9 rounded-full flex-shrink-0" style={{ backgroundColor: b.clientColor }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 truncate">{b.title}</p>
                      <p className="text-[11px] text-slate-400">{b.clientName}{b.concept ? ` · ${b.concept}` : ""}</p>
                    </div>
                    <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">{b.stage}</span>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">{b.ageDays}d</span>
                  </button>
                ))}
              </div>
            )}

            {/* Upcoming readiness — how much of the next N days' content is at Check 1+ */}
            <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">📦 Upcoming readiness</h2>
                <div className="flex bg-slate-100 rounded-lg p-0.5 text-[10px] font-semibold">
                  {[7, 14, 30].map((d) => (
                    <button key={d} onClick={() => setReadyDays(d)} className={`px-2 py-1 rounded-md transition-colors ${readyDays === d ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{d}d</button>
                  ))}
                </div>
              </div>
              {(() => {
                const { total, atCheck } = data!.readiness;
                const behind = total - atCheck;
                const pct = total ? Math.round((atCheck / total) * 100) : 0;
                return (
                  <>
                    <div className="flex items-end justify-between mb-1.5">
                      <p className="text-sm"><span className="text-2xl font-bold text-slate-800">{atCheck}</span> <span className="text-slate-400">/ {total} at Check 1+</span></p>
                      <p className="text-xs font-semibold text-slate-500">{pct}%</p>
                    </div>
                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1.5">{behind} of {total} videos planned for the next {readyDays} days are still behind Check 1.</p>
                    {data!.readiness.byClient.filter((c) => c.behind > 0).length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        {data!.readiness.byClient.filter((c) => c.behind > 0).map((c) => (
                          <button key={c.id} onClick={() => onOpenKanban(c.id)} className="w-full flex items-center gap-2 text-left group">
                            <span className="w-5 h-5 rounded-md flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0" style={{ backgroundColor: c.color }}>{c.name.slice(0, 1).toUpperCase()}</span>
                            <span className="text-xs text-slate-600 flex-1 truncate group-hover:text-slate-900">{c.name}</span>
                            <span className="text-[11px] text-amber-600 font-semibold flex-shrink-0">{c.behind} behind</span>
                            <span className="text-[10px] text-slate-400 flex-shrink-0">{c.atCheck}/{c.total}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Client health board */}
          <div className="xl:col-span-5">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Client Health</h2>
            <div className="space-y-2">
              {cards.map((c) => (
                <button key={c.id} onClick={() => onOpenKanban(c.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-left hover:shadow-sm ${RING[c.health]}`}>
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT[c.health]}`} />
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0" style={{ backgroundColor: c.color }}>{c.name.slice(0, 1).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 truncate">{c.name}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {c.signals.length === 0 ? <span className="text-[10px] text-emerald-600 font-medium">on track</span>
                        : c.signals.map((s, i) => <span key={i} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${s.level === "red" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{s.label}</span>)}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] text-slate-400">{c.ideas + c.inStage} in pipeline</p>
                    <p className="text-[10px] text-slate-400">{c.upcomingPosts} scheduled · {agoMs(c.lastActivityAt)}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: bright spots + activity */}
          <div className="xl:col-span-3 space-y-7">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">📈 Client momentum</h2>
                <div className="flex bg-slate-100 rounded-lg p-0.5 text-[10px] font-semibold">
                  <button onClick={() => setPeriod("week")} className={`px-2.5 py-1 rounded-md transition-colors ${period === "week" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>Week</button>
                  <button onClick={() => setPeriod("month")} className={`px-2.5 py-1 rounded-md transition-colors ${period === "month" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>Month</button>
                </div>
              </div>
              {momLoading ? <p className="text-xs text-slate-400">Calculating momentum…</p>
                : mom.length === 0 ? <p className="text-xs text-slate-400">No performance data.</p>
                : (
                  <div className="space-y-2">
                    {mom.map((m) => {
                      const up = (m.delta ?? 0) >= 0;
                      return (
                        <button key={m.id} onClick={() => onOpenKanban(m.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors hover:shadow-sm ${
                            m.health === "red" ? "border-red-200 bg-red-50/50" : m.health === "yellow" ? "border-amber-200 bg-amber-50/40" : m.health === "green" ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-white"
                          }`}>
                          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${m.health === "red" ? "bg-red-500" : m.health === "yellow" ? "bg-amber-400" : m.health === "green" ? "bg-emerald-500" : "bg-slate-300"}`} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-slate-800 truncate">{m.name}</p>
                            <p className="text-[10px] text-slate-400">{fmtK(m.curAvg)} vs {fmtK(m.prevAvg)} avg views · {m.curCount ?? 0} posts</p>
                          </div>
                          {m.delta != null ? (
                            <span className={`text-sm font-bold flex-shrink-0 ${up ? "text-emerald-600" : "text-red-600"}`}>
                              {up ? "▲" : "▼"} {Math.abs(m.delta * 100).toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 flex-shrink-0">{m.note === "not connected" ? "not connected" : "not enough posts"}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              <p className="text-[10px] text-slate-400 mt-2">Avg views of reels posted in the last {period === "week" ? "7" : "30"} days vs the {period === "week" ? "7" : "30"} before. 🟢 up · 🟡 flat · 🔴 down.</p>
            </div>

            <div>
              <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-3">Recent activity</h2>
              {recent.length === 0 ? <p className="text-xs text-slate-400">Nothing logged yet.</p>
                : (
                  <div className="space-y-1.5">
                    {recent.slice(0, 14).map((a) => (
                      <div key={a.id} className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5">{ACTIVITY_ICON[a.type] || "•"}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-slate-700 leading-snug"><span className="font-semibold">{a.actor}</span>{" "}
                            {a.type === "script_submitted" ? "submitted a script" : a.type === "stage_moved" ? "moved a card" : a.type === "footage_uploaded" ? "uploaded footage" : a.type === "posted" ? "went live" : a.type}
                            {a.clientName ? <span className="text-slate-400"> · {a.clientName}</span> : null}</p>
                          {a.title && <p className="text-[11px] text-slate-400 truncate">{a.title}{a.detail ? ` · ${a.detail}` : ""}</p>}
                        </div>
                        <span className="text-[10px] text-slate-300 flex-shrink-0 whitespace-nowrap">{ago(a.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>
        </div>
      </div>

      {review && (
        <HQReviewDrawer
          draftId={review.draftId}
          clientId={review.clientId}
          onClose={() => setReview(null)}
          onDone={() => { setReview(null); load(); }}
          onOpenKanban={() => { const r = review; setReview(null); onOpenKanban(r.clientId, r.draftId); }}
        />
      )}
    </div>
  );
}

// Open a draft and review it right from HQ — watch the finished cut, then approve (advance)
// or send it back — without leaving the command center.
function HQReviewDrawer({ draftId, clientId, onClose, onDone, onOpenKanban }: {
  draftId: number; clientId: number; onClose: () => void; onDone: () => void; onOpenKanban: () => void;
}) {
  const [draft, setDraft] = useState<any>(null);
  const [stages, setStages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [note, setNote] = useState("");
  const [vidErr, setVidErr] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [d, s] = await Promise.all([
          fetch(`/api/script-drafts/${draftId}`).then((r) => r.json()),
          fetch("/api/workflow/ensure-defaults", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId }) }).then((r) => r.json()),
        ]);
        setDraft(d); setStages(Array.isArray(s) ? s : []);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, [draftId, clientId]);

  const assigneesOf = (s: any) => { try { return JSON.parse(s.assignees || "[]"); } catch { return []; } };
  function nextStage() {
    if (!draft) return null;
    const idx = stages.findIndex((s) => s.id === draft.stageId);
    if (idx < 0) return null;
    for (let i = idx + 1; i < stages.length; i++) {
      const s = stages[i];
      if (/check/i.test(s.name) && assigneesOf(s).length === 0) continue;
      return s;
    }
    return null;
  }
  function prevStage() { const idx = stages.findIndex((s) => s.id === draft?.stageId); return idx > 0 ? stages[idx - 1] : null; }

  async function approve() {
    setBusy(true);
    const next = nextStage();
    await fetch(`/api/script-drafts/${draft.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stageId: next?.id ?? null, status: "accepted", rejectionFeedback: null }) });
    onDone();
  }
  async function sendBack() {
    if (!note.trim()) return;
    setBusy(true);
    const prev = prevStage();
    await fetch("/api/draft-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId: draft.id, content: `↩ Sent back: ${note}`, author: "Owner" }) }).catch(() => {});
    await fetch(`/api/script-drafts/${draft.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stageId: prev?.id ?? null, status: prev ? "accepted" : "pending", rejectionFeedback: note }) });
    onDone();
  }

  const next = nextStage();
  const rawCount = (() => { try { return JSON.parse(draft?.rawContentUrls || "[]").length; } catch { return 0; } })();

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[620px] max-w-[94vw] bg-white shadow-2xl flex flex-col overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center"><div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>
        ) : !draft ? (
          <div className="p-8 text-center text-slate-500">Couldn&apos;t load this draft.</div>
        ) : (
          <>
            <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between flex-shrink-0">
              <div>
                <p className="text-xs font-semibold text-indigo-500">{draft.concept ? (draft.concept.conceptType ? `${draft.concept.conceptType} · ${draft.concept.name}` : draft.concept.name) : ""}</p>
                <h3 className="text-sm font-bold text-slate-800">{draft.title}</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">{draft.client?.name}{draft.stage?.name ? ` · ${draft.stage.name}` : ""}</p>
              </div>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Finished video */}
              {draft.editedVideoUrl ? (
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Finished video</p>
                  <video src={vidErr ? `/api/vid?u=${encodeURIComponent(draft.editedVideoUrl)}` : draft.editedVideoUrl}
                    controls playsInline onError={() => !vidErr && setVidErr(true)}
                    className="w-full max-h-[46vh] rounded-xl bg-black" />
                </div>
              ) : (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">No finished video uploaded yet{rawCount ? ` · ${rawCount} raw file${rawCount > 1 ? "s" : ""} attached` : ""}.</p>
              )}

              {draft.hook && (
                <div><p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Hook</p>
                  <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{draft.hook}</p></div>
              )}
              <div><p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Script</p>
                <pre className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto">{draft.script}</pre></div>
              {draft.caption && (
                <div><p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Caption</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{draft.caption}</p></div>
              )}
            </div>

            {/* Actions */}
            <div className="border-t border-slate-100 px-6 py-4 flex-shrink-0 space-y-3">
              {sendBackOpen ? (
                <div className="space-y-2">
                  <textarea autoFocus rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="What needs fixing? (the editor sees this)"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setSendBackOpen(false)} className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700">Cancel</button>
                    <button onClick={sendBack} disabled={busy || !note.trim()} className="px-4 py-1.5 text-xs font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">{busy ? "Sending…" : "↩ Send back"}</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => setSendBackOpen(true)} disabled={busy} className="px-4 py-2.5 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 disabled:opacity-50">↩ Send back</button>
                  <button onClick={approve} disabled={busy} className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-50">
                    {busy ? "Working…" : `✓ Approve → ${next ? next.name : "Schedule"}`}
                  </button>
                  <button onClick={onOpenKanban} title="Open full card in Kanban" className="px-3 py-2.5 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-xl">↗</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
