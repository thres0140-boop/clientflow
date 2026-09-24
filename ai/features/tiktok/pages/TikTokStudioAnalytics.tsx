"use client";
import { AI_API } from "@/ai/slug";
import { useEffect, useState } from "react";
import { imgSrc } from "@/shared/media/videoSrc";

// TikTok Studio-style analytics, powered by Zernio. Rendered on the main Analytics page for
// TikTok-connected clients. Shows every metric TikTok's public API exposes (video views, likes,
// comments, shares, follower growth). Profile views / traffic sources / watch time are NOT on any
// public TikTok API, so they are intentionally absent.

type Delta = { d: number; pct: number } | null;
type SeriesPoint = { date: string; value: number };
type HistoryPoint = { day: string; totalViews: number | null; followerCount: number | null; likesCount: number | null };
type DailyMetric = { date: string; views: number; likes: number; comments: number; shares: number };
type Video = { id: string; content?: string; thumbnailUrl?: string; postUrl?: string; publishedAt?: string; views: number; likes: number; comments: number; shares: number; engagementRate?: number };
type Data = {
  connected: boolean; username?: string | null; days: number;
  profile: { followers: number | null; following: number | null; likes: number | null; videos: number | null };
  deltas: { followers: Delta; likes: Delta };
  series: { followers: SeriesPoint[]; likes: SeriesPoint[]; videoViews: SeriesPoint[] };
  totals: { views: number; likes: number; comments: number; shares: number; posts: number; engagementRate: number | null };
  history: HistoryPoint[];
  daily: DailyMetric[];
  videos: Video[]; error?: string;
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (a >= 1_000) return (n / 1_000).toFixed(a >= 10_000 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(n);
}
function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `${d}d ago` : `${Math.floor(d / 30)}mo ago`;
}

const RANGES: [number, string][] = [[7, "7 days"], [14, "14 days"], [30, "30 days"]];

export default function TikTokStudioAnalytics({ clientId }: { clientId: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState<number | null>(30);      // null = custom range
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [vsort, setVsort] = useState<"views" | "recent">("views");
  const [concepts, setConcepts] = useState<{ id: number; name: string }[]>([]);
  const [conceptMap, setConceptMap] = useState<Record<string, number>>({});

  useEffect(() => {
    setLoading(true);
    fetch(`${AI_API}/tiktok/analytics?clientId=${clientId}&days=365`)
      .then((r) => r.json()).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
    fetch(`${AI_API}/concepts?clientId=${clientId}&platform=tiktok`).then((r) => r.json())
      .then((cs) => setConcepts((Array.isArray(cs) ? cs : []).map((c: any) => ({ id: c.id, name: c.name })))).catch(() => setConcepts([])); // eslint-disable-line @typescript-eslint/no-explicit-any
    fetch(`${AI_API}/tiktok/video-concept?clientId=${clientId}`).then((r) => r.json())
      .then((m) => setConceptMap(m && typeof m === "object" ? m : {})).catch(() => setConceptMap({}));
  }, [clientId]);

  async function setVideoConcept(videoId: string, conceptId: number | null) {
    setConceptMap((m) => { const n = { ...m }; if (conceptId == null) delete n[videoId]; else n[videoId] = conceptId; return n; });
    await fetch(`${AI_API}/tiktok/video-concept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, videoId, conceptId }) }).catch(() => {});
  }

  if (loading && !data) return <div className="flex items-center justify-center h-32 text-faint text-sm">Loading TikTok analytics…</div>;
  if (!data?.connected) return null;

  const p = data.profile;

  // Effective window: a preset (last N CALENDAR days, INCLUDING today — matches TikTok Studio /
  // Zernio "last 7 days") or an explicit custom from/to (max 90 days back).
  const MAX_SPAN = 90;
  const now = Date.now();
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const todayStr = new Date().toISOString().slice(0, 10);
  const minFromDate = new Date(now - MAX_SPAN * 86400_000).toISOString().slice(0, 10);
  const custom = preset == null;
  const toTs = custom && to ? new Date(to + "T23:59:59").getTime() : now;
  const fromTs = custom && from
    ? new Date(from + "T00:00:00").getTime()
    : startOfToday.getTime() - ((preset ?? 30) - 1) * 86400_000;
  const spanDays = Math.max(1, Math.round((toTs - fromTs) / 86400_000) + (custom ? 0 : 1));
  const rangeText = custom && from && to ? `${from} → ${to}` : `last ${preset}d`;
  const fromYMD = new Date(fromTs).toISOString().slice(0, 10);
  const toYMD = new Date(toTs).toISOString().slice(0, 10);

  // DELIVERED per-day metrics within the window (Zernio attribution=received) — matches TikTok Studio's
  // "views per day" and Zernio's own Engagement-over-time chart.
  const dailyInRange = (data.daily || []).filter((d) => d.date >= fromYMD && d.date <= toYMD);
  const rt = dailyInRange.reduce((t, d) => { t.views += d.views; t.likes += d.likes; t.comments += d.comments; t.shares += d.shares; return t; },
    { views: 0, likes: 0, comments: 0, shares: 0 });
  const viewsByDay: SeriesPoint[] = dailyInRange.map((d) => ({ date: d.date, value: d.views }));

  // Video table: the posts published within the window.
  const rangeVideos = (data.videos || []).filter((v) => {
    if (!v.publishedAt) return false;
    const t = new Date(v.publishedAt).getTime();
    return t >= fromTs && t <= toTs;
  });
  const sortedVideos = [...rangeVideos].sort((a, b) => vsort === "views"
    ? b.views - a.views
    : new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime());

  const cards = [
    { label: "Video views", value: rt.views, sub: `delivered · ${rangeText}`, d: null as Delta },
    { label: "Likes", value: rt.likes, sub: `delivered · ${rangeText}`, d: null as Delta },
    { label: "Comments", value: rt.comments, sub: `delivered · ${rangeText}`, d: null as Delta },
    { label: "Shares", value: rt.shares, sub: `delivered · ${rangeText}`, d: null as Delta },
    { label: "Followers", value: p.followers, sub: "current total", d: data.deltas.followers },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-ink flex items-center gap-1.5"><span className="w-5 h-5 rounded bg-black text-white text-[11px] flex items-center justify-center">🎵</span> TikTok</span>
          <span className="text-xs font-semibold text-ok-700 bg-ok-50 px-2 py-0.5 rounded-full">✓ Official</span>
          {data.username && <span className="text-xs text-muted">@{data.username}</span>}
          {data.totals.engagementRate != null && <span className="text-xs text-faint">· {data.totals.engagementRate.toFixed(1)}% avg engagement</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex gap-0.5 bg-surface-3 rounded-lg p-0.5">
            {RANGES.map(([d, label]) => (
              <button key={d} onClick={() => { setPreset(d); setShowCustom(false); }} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${preset === d ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink-2"}`}>{label}</button>
            ))}
            <button onClick={() => { setShowCustom((s) => !s); if (preset != null) { setPreset(null); } }} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${custom ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink-2"}`}>Custom</button>
          </div>
          <a href="https://www.tiktok.com/tiktokstudio" target="_blank" rel="noreferrer" className="text-xs font-medium text-ink-2 bg-surface-3 rounded-lg px-3 py-1.5 hover:bg-surface-4">Studio ↗</a>
        </div>
      </div>

      {(showCustom || custom) && (
        <div className="flex items-center gap-2 flex-wrap bg-surface border border-line rounded-xl px-4 py-2.5">
          <span className="text-xs font-semibold text-ink-2">Custom range:</span>
          <input type="date" value={from} min={minFromDate} max={to || todayStr} onChange={(e) => { setFrom(e.target.value); setPreset(null); }} className="border border-line rounded-lg px-2 py-1 text-xs text-ink-2" />
          <span className="text-xs text-faint">→</span>
          <input type="date" value={to} min={from || minFromDate} max={todayStr} onChange={(e) => { setTo(e.target.value); setPreset(null); }} className="border border-line rounded-lg px-2 py-1 text-xs text-ink-2" />
          {custom && from && to && <span className="text-[11px] text-faint">{spanDays} day{spanDays === 1 ? "" : "s"}</span>}
          <span className="text-[11px] text-faint">· up to {MAX_SPAN} days</span>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-surface rounded-2xl border border-line p-4">
            <p className="text-xs text-faint">{c.label}</p>
            <p className="text-2xl font-extrabold text-ink mt-0.5 tabular-nums">{fmt(c.value)}</p>
            {c.d ? (
              <p className={`text-[11px] font-semibold mt-0.5 ${c.d.d >= 0 ? "text-ok-600" : "text-danger-500"}`}>{c.d.d >= 0 ? "↑" : "↓"} {fmt(Math.abs(c.d.d))} ({c.d.pct >= 0 ? "+" : ""}{c.d.pct.toFixed(1)}%)</p>
            ) : (
              <p className="text-[11px] text-faint mt-0.5">{c.sub}</p>
            )}
          </div>
        ))}
      </div>

      {/* Views-per-day chart */}
      <div className="bg-surface rounded-2xl border border-line p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-ink-2">Video views / day · {rangeText}</span>
          <span className="text-xs text-faint">{viewsByDay.length} day{viewsByDay.length === 1 ? "" : "s"} with posts</span>
        </div>
        {viewsByDay.length < 1 ? (
          <div className="h-40 flex items-center justify-center text-center text-xs text-faint px-6">No delivered-view data in this range yet.</div>
        ) : (
          <BarChart points={viewsByDay} />
        )}
        <p className="text-[11px] text-faint mt-2">Views <i>delivered</i> per day (Zernio&apos;s engagement-over-time), the same metric TikTok Studio charts. It can read a little lower than Studio because Zernio tracks your synced posts rather than your entire back-catalog.</p>
      </div>

      {/* Video performance */}
      <div className="bg-surface rounded-2xl border border-line overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <p className="text-sm font-semibold text-ink-2">Video performance <span className="font-normal text-faint">· {rangeText}</span></p>
          <div className="flex gap-1">
            {([["views", "Top views"], ["recent", "Recent"]] as [typeof vsort, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setVsort(id)} className={`px-2.5 py-1 rounded-lg text-xs font-medium ${vsort === id ? "bg-accent text-on-accent" : "bg-surface-3 text-muted"}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold text-faint uppercase tracking-wide border-b border-line">
                <th className="px-4 py-2.5">Video</th><th className="px-3 py-2.5">Concept</th><th className="px-3 py-2.5 text-right">Views</th><th className="px-3 py-2.5 text-right">Likes</th>
                <th className="px-3 py-2.5 text-right">Comments</th><th className="px-3 py-2.5 text-right">Shares</th><th className="px-4 py-2.5 text-right">Posted</th>
              </tr>
            </thead>
            <tbody>
              {sortedVideos.map((v) => (
                <tr key={v.id} className="border-b border-line-softer last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-2.5">
                    <a href={v.postUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 group">
                      {v.thumbnailUrl && <img src={imgSrc(v.thumbnailUrl)} alt="" className="w-9 h-12 rounded object-cover flex-shrink-0 bg-surface-3" />}
                      <span className="text-xs text-ink-2 line-clamp-2 group-hover:text-accent max-w-[280px]">{v.content || "(no caption)"}</span>
                    </a>
                  </td>
                  <td className="px-3 py-2.5">
                    <ConceptCell concepts={concepts} conceptId={conceptMap[v.id]} onSet={(cid) => setVideoConcept(v.id, cid)} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-ink-2 tabular-nums">{fmt(v.views)}</td>
                  <td className="px-3 py-2.5 text-right text-muted tabular-nums">{fmt(v.likes)}</td>
                  <td className="px-3 py-2.5 text-right text-muted tabular-nums">{fmt(v.comments)}</td>
                  <td className="px-3 py-2.5 text-right text-muted tabular-nums">{fmt(v.shares)}</td>
                  <td className="px-4 py-2.5 text-right text-[11px] text-faint">{v.publishedAt ? timeAgo(new Date(v.publishedAt).getTime()) : "—"}</td>
                </tr>
              ))}
              {sortedVideos.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-faint">No videos yet — Zernio syncs a connected account&apos;s posts within a day of linking.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-faint">Video views, likes, comments, shares and follower growth come from TikTok via Zernio. Profile views, traffic sources, watch time and audience demographics aren&apos;t available on any public TikTok API — open TikTok Studio for those.</p>
    </div>
  );
}

// Concept picker for a video row — dropdown of the client's TikTok concepts.
function ConceptCell({ concepts, conceptId, onSet }: { concepts: { id: number; name: string }[]; conceptId?: number; onSet: (id: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const current = concepts.find((c) => c.id === conceptId);
  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 transition-colors max-w-[160px] ${current ? "bg-accent-tint text-accent-strong hover:opacity-80" : "text-muted bg-surface-3 hover:bg-surface-4"}`}>
        {current ? <span className="truncate">{current.name}</span> : <><span className="text-[13px] leading-none">＋</span> Concept</>}
        <span className="text-[8px] opacity-60">▼</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-30 mt-1 w-56 max-h-64 overflow-auto bg-surface border border-line rounded-xl shadow-lg py-1">
            {concepts.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-faint">No TikTok concepts yet. Create them in the Concept Library.</p>
            ) : concepts.map((c) => (
              <button key={c.id} type="button" onClick={() => { onSet(c.id); setOpen(false); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent-tint truncate ${c.id === conceptId ? "font-semibold text-accent-strong" : "text-ink-2"}`}>
                {c.id === conceptId ? "✓ " : ""}{c.name}
              </button>
            ))}
            {conceptId != null && (
              <button type="button" onClick={() => { onSet(null); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-danger-500 hover:bg-danger-50 border-t border-line mt-1">Clear</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Per-day bar chart (TikTok Studio-style video-views-per-day). A date label sits under each bar;
// when there are many bars the labels thin out so they don't collide.
function BarChart({ points }: { points: SeriesPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 16 ? Math.ceil(points.length / 12) : 1;
  return (
    <div>
      <div className="flex items-end gap-1 h-40">
        {points.map((p) => (
          <div key={p.date} className="flex-1 h-full flex flex-col justify-end items-center group relative min-w-0">
            <div className="absolute -top-6 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-semibold text-ink bg-surface border border-line rounded px-1.5 py-0.5 whitespace-nowrap z-10 pointer-events-none">
              {fmt(p.value)}
            </div>
            <div className="w-full rounded-t bg-accent/80 hover:bg-accent transition-colors" style={{ height: `${Math.max(2, (p.value / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1.5">
        {points.map((p, i) => (
          <div key={p.date} className="flex-1 text-center text-[9px] text-faint min-w-0 truncate">
            {i % step === 0 ? p.date.slice(5) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ points }: { points: SeriesPoint[] }) {
  const W = 720, H = 180, pad = 8;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / range) * (H - pad * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(points.length - 1).toFixed(1)} ${H - pad} L ${x(0).toFixed(1)} ${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ height: 180 }}>
      <defs>
        <linearGradient id="ttStudioFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent, #3d4aa3)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-accent, #3d4aa3)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#ttStudioFill)" />
      <path d={line} fill="none" stroke="var(--color-accent, #3d4aa3)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 3.5 : 0} fill="var(--color-accent, #3d4aa3)" />)}
    </svg>
  );
}
