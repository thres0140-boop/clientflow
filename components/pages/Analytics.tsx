"use client";

import { useEffect, useState, useRef } from "react";
import { Client, AnalyticsEntry, ContentPiece, TrackedVideo } from "@/lib/types";

type Props = { clients: Client[]; selectedClientId: number | null; refreshClients: () => void };
type MainTab = "general" | "concept";
type Period = "week" | "2weeks" | "month";
type ManualKey = "follows" | "messagesSent" | "messagesAnswered" | "linksSent" | "bookedCalls";

// ── Timezone-safe date helpers ──────────────────────────────────────────
function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function getMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}
function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function periodDays(p: Period): number {
  return p === "week" ? 7 : p === "2weeks" ? 14 : 28;
}
function datesInRange(start: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => toYMD(addDays(start, i)));
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS   = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function shortDay(dateStr: string): string {
  const d = fromYMD(dateStr);
  const w = d.getDay();
  return `${DAYS[w === 0 ? 6 : w - 1]} ${d.getDate()}`;
}
function rangeLabel(start: Date, count: number): string {
  const end = addDays(start, count - 1);
  const sm = MONTHS[start.getMonth()], em = MONTHS[end.getMonth()];
  return start.getMonth() === end.getMonth()
    ? `${sm} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
    : `${sm} ${start.getDate()} – ${em} ${end.getDate()}, ${end.getFullYear()}`;
}

// ── Column definitions ──────────────────────────────────────────────────
const MANUAL_COLS: { key: ManualKey; label: string; group?: "dm" | "booking" }[] = [
  { key: "follows",          label: "Follows" },
  { key: "messagesSent",     label: "Msgs Sent",     group: "dm" },
  { key: "messagesAnswered", label: "Msgs Answered",  group: "dm" },
  { key: "linksSent",        label: "Links Sent",     group: "booking" },
  { key: "bookedCalls",      label: "Booked Calls",   group: "booking" },
];

type ManualEntry = Partial<Record<ManualKey, string>> & { id?: number; videoLink?: string };
type AutoDay = { views: number; likes: number; shares: number; concepts: string[]; videoUrl: string | null };

export default function Analytics({ clients, selectedClientId, refreshClients }: Props) {
  const [tab, setTab]           = useState<MainTab>("general");
  const [period, setPeriod]     = useState<Period>("week");
  const [startDate, setStartDate] = useState<Date>(() => getMonday(new Date()));
  const [compareMode, setCompareMode] = useState(false);
  const [showDMs, setShowDMs]   = useState(true);
  const [showBooking, setShowBooking] = useState(true);

  // Raw data
  const [allContent, setAllContent] = useState<ContentPiece[]>([]);
  const [allVideos,  setAllVideos]  = useState<TrackedVideo[]>([]);
  const [dmLeads,    setDmLeads]    = useState<any[]>([]);
  const [igReels,    setIgReels]    = useState<any[]>([]); // live posted reels from Instagram

  // Manual entries: date → ManualEntry
  const [manual, setManual] = useState<Record<string, ManualEntry>>({});
  const manualRef = useRef(manual);
  manualRef.current = manual;

  const [saving, setSaving] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Booking link
  const [bookingLink, setBookingLink] = useState("");
  const [editingBL,   setEditingBL]   = useState(false);

  // Concept tab
  const [conceptWeeksBack, setConceptWeeksBack] = useState(8);

  const client = clients.find((c) => c.id === selectedClientId) ?? null;

  useEffect(() => { setBookingLink(client?.bookingLink ?? ""); }, [client]);

  // Fetch all data when client changes
  useEffect(() => {
    if (!selectedClientId) return;
    setAllContent([]); setAllVideos([]); setManual({});

    const loadAll = () => Promise.all([
      fetch(`/api/content?clientId=${selectedClientId}`).then((r) => r.json()),
      fetch(`/api/videos?clientId=${selectedClientId}`).then((r) => r.json()),
      fetch(`/api/analytics?clientId=${selectedClientId}`).then((r) => r.json()),
    ]).then(([content, videos, analytics]) => {
      setAllContent(Array.isArray(content) ? content : []);
      setAllVideos(Array.isArray(videos) ? videos : []);
      const entries: AnalyticsEntry[] = Array.isArray(analytics) ? analytics : [];
      const m: Record<string, ManualEntry> = {};
      for (const e of entries) {
        m[e.date] = {
          id: e.id,
          follows:          e.follows          ? String(e.follows)          : "",
          messagesSent:     e.messagesSent     ? String(e.messagesSent)     : "",
          messagesAnswered: e.messagesAnswered ? String(e.messagesAnswered) : "",
          linksSent:        e.linksSent        ? String(e.linksSent)        : "",
          bookedCalls:      e.bookedCalls      ? String(e.bookedCalls)      : "",
          videoLink:        (e as any).videoLink ?? "",
        };
      }
      setManual(m);
    });

    const loadLeads = () =>
      fetch(`/api/dm-leads?clientId=${selectedClientId}`).then((r) => r.json())
        .then((d) => setDmLeads(Array.isArray(d) ? d : [])).catch(() => {});

    // Live posted reels from Instagram — so analytics shows real post performance even
    // when a reel isn't linked to a concept/scheduled content.
    const loadReels = () =>
      fetch(`/api/instagram/media?clientId=${selectedClientId}`).then((r) => r.json())
        .then((d) => setIgReels(Array.isArray(d?.reels) ? d.reels : Array.isArray(d) ? d : []))
        .catch(() => {});

    setIgReels([]);
    loadAll();
    loadLeads();
    loadReels();
    // Trigger server-side DM detection, then reload analytics + leads to reflect fresh data
    fetch(`/api/zernio/sync-pipeline?clientId=${selectedClientId}`)
      .then(() => { loadAll(); loadLeads(); })
      .catch(() => {});
  }, [selectedClientId]);

  // DM funnel columns are computed from the pipeline leads' real dates (source of truth),
  // not stored counters — so they land on the day each event actually happened.
  function ymdOf(s?: string | null): string | null {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : toYMD(d);
  }
  // Event-date bucketing: each action counts on the day it actually happened — a message
  // sent today, a link sent today, a booking today — even if the conversation started earlier.
  function dmCount(date: string, key: ManualKey): number {
    if (key === "messagesSent")     return dmLeads.filter((l) => ymdOf(l.date) === date).length;
    if (key === "messagesAnswered") return dmLeads.filter((l) => ymdOf(l.repliedAt) === date).length;
    if (key === "linksSent")        return dmLeads.filter((l) => ymdOf(l.linkSentAt) === date).length;
    if (key === "bookedCalls")      return dmLeads.filter((l) => ymdOf(l.bookedAt) === date).length;
    return 0;
  }
  const DM_AUTO_KEYS: ManualKey[] = ["messagesSent", "messagesAnswered", "linksSent", "bookedCalls"];

  // Build auto data (views/likes/shares from TrackedVideo, concepts from ContentPiece)
  function buildAutoMap(dates: string[]): Record<string, AutoDay> {
    const map: Record<string, AutoDay> = {};
    for (const d of dates) map[d] = { views: 0, likes: 0, shares: 0, concepts: [], videoUrl: null };
    for (const v of allVideos) {
      if (v.datePosted && map[v.datePosted]) {
        map[v.datePosted].views  += v.views;
        map[v.datePosted].likes  += v.likes;
        map[v.datePosted].shares += v.shares;
        if (!map[v.datePosted].videoUrl && v.url) map[v.datePosted].videoUrl = v.url;
      }
    }
    for (const c of allContent) {
      const day = c.scheduledDate?.slice(0, 10);
      if (day && map[day]) {
        const name = c.concept?.name;
        if (name && !map[day].concepts.includes(name)) map[day].concepts.push(name);
        if (!map[day].videoUrl) {
          map[day].videoUrl = c.igMediaId
            ? `https://www.instagram.com/reel/${c.igMediaId}/`
            : (c.rawContentUrl || null);
        }
      }
    }
    // Real posted reels from Instagram — bucket by posted date (works without a concept link)
    for (const r of igReels) {
      if (!r.timestamp) continue;
      const day = new Date(r.timestamp);
      if (isNaN(day.getTime())) continue;
      const ymd = toYMD(day);
      if (!map[ymd]) continue;
      map[ymd].views  += r.plays ?? 0;
      map[ymd].likes  += r.like_count ?? 0;
      map[ymd].shares += r.shares ?? 0;
      if (!map[ymd].videoUrl) map[ymd].videoUrl = r.permalink ?? r.media_url ?? null;
    }
    return map;
  }

  function handleManualChange(date: string, key: ManualKey, value: string) {
    setManual((prev) => ({ ...prev, [date]: { ...prev[date], [key]: value } }));
    if (saveTimers.current[date]) clearTimeout(saveTimers.current[date]);
    saveTimers.current[date] = setTimeout(() => saveManual(date), 700);
  }

  function handleLinkChange(date: string, value: string) {
    setManual((prev) => ({ ...prev, [date]: { ...prev[date], videoLink: value } }));
    if (saveTimers.current[date]) clearTimeout(saveTimers.current[date]);
    saveTimers.current[date] = setTimeout(() => saveManual(date), 700);
  }

  async function saveManual(date: string) {
    if (!selectedClientId) return;
    const m = manualRef.current[date] ?? {};
    setSaving(date);
    try {
      const saved = await fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClientId,
          date,
          follows:          parseInt(m.follows          ?? "0") || 0,
          messagesSent:     parseInt(m.messagesSent     ?? "0") || 0,
          messagesAnswered: parseInt(m.messagesAnswered ?? "0") || 0,
          linksSent:        parseInt(m.linksSent        ?? "0") || 0,
          bookedCalls:      parseInt(m.bookedCalls      ?? "0") || 0,
          videoLink:        m.videoLink ?? "",
        }),
      }).then((r) => r.json());
      setManual((prev) => ({ ...prev, [date]: { ...prev[date], id: saved.id } }));
    } finally {
      setSaving(null);
    }
  }

  async function saveBL() {
    if (!client) return;
    await fetch(`/api/clients/${client.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...client, bookingLink }),
    });
    setEditingBL(false);
    refreshClients();
  }

  // Derived
  const days  = periodDays(period);
  const dates = datesInRange(startDate, days);
  const cmpDates = datesInRange(addDays(startDate, -days), days);
  const allDates = [...dates, ...cmpDates];
  const autoMap  = buildAutoMap(allDates);

  const visibleCols = MANUAL_COLS.filter((c) => {
    if (c.group === "dm"      && !showDMs)     return false;
    if (c.group === "booking" && !showBooking) return false;
    return true;
  });

  function autoSum(ds: string[], field: "views" | "likes" | "shares"): number {
    return ds.reduce((s, d) => s + (autoMap[d]?.[field] ?? 0), 0);
  }
  function manualSum(ds: string[], key: ManualKey): number {
    // DM funnel columns are computed from leads; follows stays from manual entry
    if (DM_AUTO_KEYS.includes(key)) return ds.reduce((s, d) => s + dmCount(d, key), 0);
    return ds.reduce((s, d) => s + (parseInt(manualRef.current[d]?.[key] ?? "0") || 0), 0);
  }
  function answerRate(ds: string[]): number | null {
    const sent = manualSum(ds, "messagesSent");
    return sent > 0 ? Math.round((manualSum(ds, "messagesAnswered") / sent) * 100) : null;
  }
  function linkRate(ds: string[]): number | null {
    const answered = manualSum(ds, "messagesAnswered");
    return answered > 0 ? Math.round((manualSum(ds, "linksSent") / answered) * 100) : null;
  }
  function bookingRateFn(ds: string[]): number | null {
    const links = manualSum(ds, "linksSent");
    return links > 0 ? Math.round((manualSum(ds, "bookedCalls") / links) * 100) : null;
  }

  function fmtN(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
  }

  // ── Render table (reused for main + compare) ─────────────────────────
  function renderTable(ds: string[], isCompare = false) {
    const ar   = answerRate(ds);
    const lr   = linkRate(ds);
    const br   = bookingRateFn(ds);
    const ring = isCompare ? "border-indigo-100" : "border-slate-200";
    const head = isCompare ? "bg-indigo-50/50 border-indigo-100" : "bg-slate-50 border-slate-200";
    const foot = isCompare ? "bg-indigo-50/30 border-indigo-200" : "bg-slate-50 border-slate-200";
    const stickyHead = isCompare ? "bg-indigo-50/50" : "bg-slate-50";

    return (
      <div className={`bg-white rounded-xl border overflow-x-auto ${ring}`}>
        <table className="text-sm min-w-full">
          <thead>
            <tr className={`border-b ${head}`}>
              <th className={`px-3 py-2.5 text-left text-xs font-semibold sticky left-0 z-10 min-w-[76px] ${stickyHead} ${isCompare ? "text-indigo-400" : "text-slate-500"}`}>Day</th>
              <th className={`px-3 py-2.5 text-left text-xs font-semibold min-w-[130px] ${isCompare ? "text-indigo-400" : "text-slate-500"}`}>Concept</th>
              <th className={`px-3 py-2.5 text-left text-xs font-semibold min-w-[100px] ${isCompare ? "text-indigo-400" : "text-slate-500"}`}>Link</th>
              {(["views","likes","shares"] as const).map((f) => (
                <th key={f} className={`px-3 py-2.5 text-right text-xs font-semibold capitalize ${isCompare ? "text-indigo-300" : "text-slate-400"}`}>{f}</th>
              ))}
              {visibleCols.map((c) => (
                <th key={c.key} className={`px-3 py-2.5 text-right text-xs font-semibold whitespace-nowrap ${
                  c.group === "dm" ? "text-blue-500" : c.group === "booking" ? "text-purple-500" : isCompare ? "text-indigo-400" : "text-slate-500"
                }`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ds.map((date) => {
              const auto = autoMap[date] ?? { views: 0, likes: 0, shares: 0, concepts: [], videoUrl: null };
              const man  = manual[date] ?? {};
              const conceptLabel = auto.concepts.length === 0 ? null
                : auto.concepts.length === 1 ? auto.concepts[0] : "Multiple";

              return (
                <tr key={date} className="hover:bg-slate-50/50 group">
                  <td className={`px-3 py-2 sticky left-0 z-10 bg-white group-hover:bg-slate-50/50 ${isCompare ? "text-indigo-400" : ""}`}>
                    <span className="font-medium text-slate-700 text-xs whitespace-nowrap">{shortDay(date)}</span>
                  </td>
                  {/* Concept (auto from scheduled content) + reel link */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {conceptLabel ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-600 font-medium max-w-[120px] truncate">
                          {conceptLabel}
                        </span>
                      ) : (
                        <span className="text-slate-200 text-xs">—</span>
                      )}
                    </div>
                  </td>
                  {/* Reel link — editable, auto-prefilled from detected reel URL */}
                  <td className="px-2 py-1.5">
                    {(() => {
                      const linkVal = man.videoLink ?? auto.videoUrl ?? "";
                      return (
                        <div className="flex items-center gap-1">
                          <input
                            type="url"
                            value={man.videoLink ?? (auto.videoUrl || "")}
                            onChange={(e) => handleLinkChange(date, e.target.value)}
                            placeholder="paste reel link"
                            className="w-full text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-2 py-1 placeholder-slate-200 text-slate-600 min-w-[90px]"
                          />
                          {linkVal && (
                            <a href={linkVal} target="_blank" rel="noopener noreferrer"
                              title="Open reel" className="text-slate-400 hover:text-indigo-600 text-xs flex-shrink-0">↗</a>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  {/* Auto stats from TrackedVideo */}
                  {(["views","likes","shares"] as const).map((f) => (
                    <td key={f} className="px-3 py-2 text-right">
                      <span className={`text-xs font-medium ${auto[f] > 0 ? (isCompare ? "text-indigo-500" : "text-slate-700") : "text-slate-200"}`}>
                        {auto[f] > 0 ? fmtN(auto[f]) : "—"}
                      </span>
                    </td>
                  ))}
                  {/* DM funnel columns = computed (read-only); follows = manual input */}
                  {visibleCols.map((c) => {
                    if (DM_AUTO_KEYS.includes(c.key)) {
                      const v = dmCount(date, c.key);
                      return (
                        <td key={c.key} className="px-3 py-2 text-right">
                          <span className={`text-xs font-medium ${v > 0 ? (c.group === "dm" ? "text-blue-600" : "text-purple-600") : "text-slate-200"}`}>
                            {v > 0 ? v : "—"}
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} className="px-1.5 py-1.5">
                        <input
                          type="number"
                          min="0"
                          value={man[c.key] ?? ""}
                          onChange={(e) => handleManualChange(date, c.key, e.target.value)}
                          placeholder="—"
                          className="w-full text-right text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-2 py-1 placeholder-slate-200 min-w-[58px] text-slate-700"
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {/* Totals row */}
            <tr className={`border-t-2 ${foot}`}>
              <td className={`px-3 py-2.5 text-xs font-semibold sticky left-0 z-10 ${foot} ${isCompare ? "text-indigo-400" : "text-slate-600"}`}>Total</td>
              <td /><td />
              {(["views","likes","shares"] as const).map((f) => {
                const t = autoSum(ds, f);
                return (
                  <td key={f} className={`px-3 py-2.5 text-right text-xs font-bold ${isCompare ? "text-indigo-500" : "text-slate-800"}`}>
                    {t > 0 ? fmtN(t) : "—"}
                  </td>
                );
              })}
              {visibleCols.map((c) => {
                const t = manualSum(ds, c.key);
                return (
                  <td key={c.key} className={`px-3 py-2.5 text-right text-xs font-bold ${
                    c.group === "dm" ? "text-blue-600" : c.group === "booking" ? "text-purple-600" : isCompare ? "text-indigo-500" : "text-slate-800"
                  }`}>{t > 0 ? t : "—"}</td>
                );
              })}
            </tr>
            {/* Rates row */}
            {(showDMs || showBooking) && (ar !== null || lr !== null || br !== null) && (
              <tr className={`border-t border-dashed ${isCompare ? "border-indigo-100" : "border-slate-200"}`}>
                <td className={`px-3 py-1.5 text-xs sticky left-0 z-10 ${isCompare ? "text-indigo-300 bg-white" : "text-slate-400 bg-white"}`}>Rate</td>
                <td /><td /><td /><td /><td />
                {visibleCols.map((c) => {
                  let rate: string | null = null;
                  if (c.key === "messagesAnswered" && ar !== null) rate = `${ar}% ans.`;
                  if (c.key === "linksSent"        && lr !== null) rate = `${lr}% link`;
                  if (c.key === "bookedCalls"      && br !== null) rate = `${br}% bkd.`;
                  return (
                    <td key={c.key} className="px-3 py-1.5 text-right text-xs">
                      {rate && <span className={`font-medium ${isCompare ? "text-indigo-400" : "text-slate-500"}`}>{rate}</span>}
                    </td>
                  );
                })}
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    );
  }

  // ── Concept Analytics ─────────────────────────────────────────────────
  const nowMonday = getMonday(new Date());
  const conceptWeekStarts: Date[] = Array.from({ length: conceptWeeksBack }, (_, i) =>
    getMonday(addDays(nowMonday, -7 * (conceptWeeksBack - 1 - i)))
  );

  const conceptMap: Record<number, string> = {};
  for (const v of allVideos) {
    if (v.conceptId && v.concept?.name) conceptMap[v.conceptId] = v.concept.name;
  }
  const conceptIds = Object.keys(conceptMap).map(Number);

  function conceptWeekViews(cid: number, ws: Date): number {
    const from = toYMD(ws);
    const to   = toYMD(addDays(ws, 6));
    return allVideos
      .filter((v) => v.conceptId === cid && v.datePosted && v.datePosted >= from && v.datePosted <= to)
      .reduce((s, v) => s + v.views, 0);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Analytics</h1>
          <p className="text-slate-500 mt-0.5 text-sm">Auto-populated from calendar · Adjust manually if needed</p>
        </div>
        {client && (
          <div className="flex items-center gap-2">
            {editingBL ? (
              <>
                <input
                  autoFocus value={bookingLink} onChange={(e) => setBookingLink(e.target.value)}
                  placeholder="https://cal.com/..." className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button onClick={saveBL} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700">Save</button>
                <button onClick={() => setEditingBL(false)} className="px-3 py-1.5 text-slate-500 hover:bg-slate-100 rounded-lg text-xs">Cancel</button>
              </>
            ) : (
              <button onClick={() => setEditingBL(true)} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 text-xs">
                🔗 {bookingLink ? "Edit booking link" : "Add booking link"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {(["general", "concept"] as MainTab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            {t === "general" ? "📊 General Analytics" : "💡 Concept Analytics"}
          </button>
        ))}
      </div>

      {/* ── General tab ── */}
      {tab === "general" && (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Period */}
            <div className="flex gap-0.5 bg-slate-100 rounded-lg p-0.5">
              {(["week","2weeks","month"] as Period[]).map((p) => (
                <button key={p} onClick={() => { setPeriod(p); setStartDate(getMonday(new Date())); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${period === p ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                  {p === "week" ? "1 Week" : p === "2weeks" ? "2 Weeks" : "Month"}
                </button>
              ))}
            </div>

            {/* Date nav */}
            <div className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden">
              <button onClick={() => setStartDate((d) => addDays(d, -days))} className="px-3 py-2 hover:bg-slate-50 text-slate-500 border-r border-slate-200">‹</button>
              <span className="px-4 text-sm font-medium text-slate-700 whitespace-nowrap">{rangeLabel(startDate, days)}</span>
              <button onClick={() => setStartDate((d) => addDays(d, days))}  className="px-3 py-2 hover:bg-slate-50 text-slate-500 border-l border-slate-200">›</button>
            </div>

            <button onClick={() => setStartDate(getMonday(new Date()))}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 bg-white">
              Now
            </button>

            <button onClick={() => setCompareMode((v) => !v)}
              className={`px-3 py-2 text-xs rounded-lg border font-medium transition-colors ${compareMode ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              ⇔ Compare prev period
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setShowDMs((v) => !v)}
                className={`px-3 py-1.5 text-xs rounded-lg border font-medium ${showDMs ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-slate-200 text-slate-400"}`}>
                💬 DMs
              </button>
              <button onClick={() => setShowBooking((v) => !v)}
                className={`px-3 py-1.5 text-xs rounded-lg border font-medium ${showBooking ? "bg-purple-50 border-purple-200 text-purple-700" : "bg-white border-slate-200 text-slate-400"}`}>
                📅 Booking
              </button>
            </div>
            {saving && <span className="text-xs text-slate-400 animate-pulse">Saving…</span>}
          </div>

          {!selectedClientId ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
              Select a client to view analytics
            </div>
          ) : (
            <div className="space-y-3">
              {/* Legend */}
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-slate-300 inline-block" /> Views/Likes/Shares auto-tracked from videos</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-indigo-300 inline-block" /> Concepts auto from scheduled content</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-blue-300 inline-block" /> DMs & Booking — enter manually</span>
              </div>

              {renderTable(dates)}

              {compareMode && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center gap-3 text-xs text-indigo-500 font-medium">
                    <span className="flex-1 h-px bg-indigo-100" />
                    <span>⇔ Previous period: {rangeLabel(addDays(startDate, -days), days)}</span>
                    <span className="flex-1 h-px bg-indigo-100" />
                  </div>
                  {renderTable(cmpDates, true)}
                </div>
              )}

              {bookingLink && !editingBL && (
                <div className="flex items-center gap-2 text-xs text-slate-400 pt-1">
                  <span>📅</span>
                  <a href={bookingLink} target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline truncate max-w-xs">{bookingLink}</a>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Concept Analytics tab ── */}
      {tab === "concept" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Show last</span>
            {[4, 8, 12].map((n) => (
              <button key={n} onClick={() => setConceptWeeksBack(n)}
                className={`px-3 py-1.5 text-xs rounded-lg border font-medium ${conceptWeeksBack === n ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                {n} weeks
              </button>
            ))}
          </div>

          {!selectedClientId ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">Select a client</div>
          ) : conceptIds.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
              No tracked videos yet. Track videos and tag them to concepts to see weekly performance here.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="text-sm min-w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 sticky left-0 bg-slate-50 min-w-[160px]">Concept</th>
                    {conceptWeekStarts.map((ws, i) => (
                      <th key={i} className="px-3 py-3 text-right text-xs font-semibold text-slate-400 whitespace-nowrap min-w-[72px]">
                        {MONTHS[ws.getMonth()]} {ws.getDate()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {conceptIds.map((cid) => (
                    <tr key={cid} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-medium text-slate-700 sticky left-0 bg-white text-sm">{conceptMap[cid]}</td>
                      {conceptWeekStarts.map((ws, i) => {
                        const views = conceptWeekViews(cid, ws);
                        const prev  = i > 0 ? conceptWeekViews(cid, conceptWeekStarts[i - 1]) : null;
                        const delta = prev !== null ? views - prev : null;
                        return (
                          <td key={i} className="px-3 py-3 text-right">
                            {views > 0 ? (
                              <div className="inline-flex flex-col items-end gap-0">
                                <span className="text-xs font-semibold text-slate-700">{fmtN(views)}</span>
                                {delta !== null && delta !== 0 && (
                                  <span className={`text-[10px] font-bold leading-tight ${delta > 0 ? "text-green-500" : "text-red-400"}`}>
                                    {delta > 0 ? "↑" : "↓"}{fmtN(Math.abs(delta))}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-200 text-xs">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
