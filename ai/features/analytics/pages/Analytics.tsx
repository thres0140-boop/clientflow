"use client";
import { AI_API } from "@/ai/slug";

import { useEffect, useState, useRef } from "react";
import { Client, AnalyticsEntry, ContentPiece, TrackedVideo } from "@/ai/shared/types";
import TikTokStudioAnalytics from "@/ai/features/tiktok/pages/TikTokStudioAnalytics";

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
  const [concepts,   setConcepts]   = useState<any[]>([]);
  const [dmLeads,    setDmLeads]    = useState<any[]>([]);
  const [igReels,    setIgReels]    = useState<any[]>([]); // live posted reels from Instagram
  const [schedDrafts, setSchedDrafts] = useState<any[]>([]); // scheduled script drafts (concept source by day)

  // Manual entries: date → ManualEntry
  const [manual, setManual] = useState<Record<string, ManualEntry>>({});
  const manualRef = useRef(manual);
  manualRef.current = manual;

  const [saving, setSaving] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Booking link
  const [bookingLink, setBookingLink] = useState("");
  const [editingBL,   setEditingBL]   = useState(false);

  // Concept tab — persisted period (weeks).
  const [conceptWeeksBack, setConceptWeeksBack] = useState<number>(() => {
    if (typeof window !== "undefined") { const v = parseInt(localStorage.getItem("cfai_concept_weeks") || ""); if (v) return v; }
    return 8;
  });
  function setConceptWeeks(n: number) {
    setConceptWeeksBack(n);
    try { localStorage.setItem("cfai_concept_weeks", String(n)); } catch { /* */ }
  }
  const [conceptReels, setConceptReels] = useState<string | null>(null);

  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  // A TikTok-connected client with Instagram off gets only the TikTok dashboard — the IG-style
  // per-day grid (views/likes/DMs/booking) is meaningless there.
  const tiktokOnly = !!(client as any)?.tiktokZernioAccountId && !client?.instagramEnabled; // eslint-disable-line @typescript-eslint/no-explicit-any

  useEffect(() => { setBookingLink(client?.bookingLink ?? ""); }, [client]);

  // Fetch all data when client changes
  useEffect(() => {
    if (!selectedClientId) return;
    setAllContent([]); setAllVideos([]); setManual({}); setConcepts([]); setSchedDrafts([]);

    const loadAll = () => Promise.all([
      fetch(`${AI_API}/content?clientId=${selectedClientId}`).then((r) => r.json()),
      fetch(`${AI_API}/videos?clientId=${selectedClientId}`).then((r) => r.json()),
      fetch(`${AI_API}/analytics?clientId=${selectedClientId}`).then((r) => r.json()),
      fetch(`${AI_API}/concepts?clientId=${selectedClientId}`).then((r) => r.json()),
      fetch(`${AI_API}/script-drafts?clientId=${selectedClientId}&scheduled=true`).then((r) => r.json()),
    ]).then(([content, videos, analytics, concepts, drafts]) => {
      setAllContent(Array.isArray(content) ? content : []);
      setAllVideos(Array.isArray(videos) ? videos : []);
      setSchedDrafts(Array.isArray(drafts) ? drafts : []);
      setConcepts(Array.isArray(concepts) ? concepts.filter((c: any) => !c.isIdea) : []);
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
      fetch(`${AI_API}/dm-leads?clientId=${selectedClientId}`).then((r) => r.json())
        .then((d) => setDmLeads(Array.isArray(d) ? d : [])).catch(() => {});

    // Live posted reels from Instagram — so analytics shows real post performance even
    // when a reel isn't linked to a concept/scheduled content.
    const loadReels = () =>
      fetch(`${AI_API}/instagram/media?clientId=${selectedClientId}`).then((r) => r.json())
        .then((d) => setIgReels(Array.isArray(d?.reels) ? d.reels : Array.isArray(d) ? d : []))
        .catch(() => {});

    setIgReels([]);
    loadAll();
    loadLeads();
    loadReels();
    // Trigger server-side DM detection, then reload analytics + leads to reflect fresh data
    fetch(`${AI_API}/zernio/sync-pipeline?clientId=${selectedClientId}`)
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

  // Full concept label is always "Type · Name" (e.g. "Value · A") — never the bare variant.
  function conceptLabel(c?: { name?: string | null; conceptType?: string | null } | null): string | null {
    if (!c) return null;
    if (c.conceptType && c.name) return `${c.conceptType} · ${c.name}`;
    return c.conceptType || c.name || null;
  }

  // Map reel shortcode -> concept label, from each concept's attached reel group.
  function shortcodeOf(url: string): string | null {
    const m = (url || "").match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/i);
    return m ? m[1] : null;
  }
  function buildConceptByShortcode(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const c of concepts) {
      let urls: string[] = [];
      try { urls = JSON.parse(c.reelUrls || "[]"); } catch { urls = []; }
      const label = conceptLabel(c) ?? c.name;
      for (const u of urls) {
        const sc = shortcodeOf(u);
        if (sc && !out[sc]) out[sc] = label;
      }
    }
    return out;
  }

  // Build auto data (views/likes/shares from TrackedVideo, concepts from ContentPiece + reel groups)
  function buildAutoMap(dates: string[]): Record<string, AutoDay> {
    const map: Record<string, AutoDay> = {};
    for (const d of dates) map[d] = { views: 0, likes: 0, shares: 0, concepts: [], videoUrl: null };
    const conceptBySc = buildConceptByShortcode();
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
        const lbl = conceptLabel(c.concept as any);
        if (lbl && !map[day].concepts.includes(lbl)) map[day].concepts.push(lbl);
        if (!map[day].videoUrl) {
          map[day].videoUrl = c.rawContentUrl || null;
        }
      }
    }
    // Posted script drafts link their concept to the day they went live. Only POSTED
    // drafts count — planned/scheduled-but-not-yet-posted content must not appear in
    // analytics (analytics reflects real performance, not the plan).
    for (const d of schedDrafts) {
      if ((d as any).status !== "posted") continue;
      const day = (d.scheduledDate || "").slice(0, 10);
      if (!day || !map[day]) continue;
      const lbl = conceptLabel(d.concept);
      if (lbl && !map[day].concepts.includes(lbl)) map[day].concepts.push(lbl);
      if (!map[day].videoUrl && (d as any).editedVideoUrl) map[day].videoUrl = (d as any).editedVideoUrl;
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
      if (!map[ymd].videoUrl) map[ymd].videoUrl = r.permalink || r.media_url || null;
      // If this reel is attached to a concept group, surface that concept on the day.
      const sc = shortcodeOf(r.permalink || "");
      const lbl = sc ? conceptBySc[sc] : null;
      if (lbl && !map[ymd].concepts.includes(lbl)) map[ymd].concepts.push(lbl);
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
      const saved = await fetch(`${AI_API}/analytics`, {
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
    await fetch(`${AI_API}/clients/${client.id}`, {
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
    const ring = isCompare ? "border-accent-tint" : "border-line";
    const head = isCompare ? "bg-accent-tint/50 border-accent-tint" : "bg-surface-2 border-line";
    const foot = isCompare ? "bg-accent-tint/30 border-accent-tint" : "bg-surface-2 border-line";
    const stickyHead = isCompare ? "bg-accent-tint/50" : "bg-surface-2";

    return (
      <div className={`bg-surface rounded-xl border overflow-x-auto ${ring}`}>
        <table className="text-sm min-w-full">
          <thead>
            <tr className={`border-b ${head}`}>
              <th className={`px-3 py-2.5 text-left text-xs font-semibold sticky left-0 z-10 min-w-[76px] ${stickyHead} ${isCompare ? "text-accent" : "text-muted"}`}>Day</th>
              <th className={`px-3 py-2.5 text-left text-xs font-semibold min-w-[130px] ${isCompare ? "text-accent" : "text-muted"}`}>Concept</th>
              <th className={`px-3 py-2.5 text-left text-xs font-semibold min-w-[100px] ${isCompare ? "text-accent" : "text-muted"}`}>Link</th>
              {(["views","likes","shares"] as const).map((f) => (
                <th key={f} className={`px-3 py-2.5 text-right text-xs font-semibold capitalize ${isCompare ? "text-accent" : "text-faint"}`}>{f}</th>
              ))}
              {visibleCols.map((c) => (
                <th key={c.key} className={`px-3 py-2.5 text-right text-xs font-semibold whitespace-nowrap ${
                  c.group === "dm" ? "text-info-500" : c.group === "booking" ? "text-accent" : isCompare ? "text-accent" : "text-muted"
                }`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ds.map((date) => {
              const auto = autoMap[date] ?? { views: 0, likes: 0, shares: 0, concepts: [], videoUrl: null };
              const man  = manual[date] ?? {};
              const conceptLabel = auto.concepts.length === 0 ? null
                : auto.concepts.length === 1 ? auto.concepts[0] : "Multiple";

              return (
                <tr key={date} className="hover:bg-surface-2/50 group">
                  <td className={`px-3 py-2 sticky left-0 z-10 bg-surface group-hover:bg-surface-2/50 ${isCompare ? "text-accent" : ""}`}>
                    <span className="font-medium text-ink-2 text-xs whitespace-nowrap">{shortDay(date)}</span>
                  </td>
                  {/* Concept (auto from scheduled content) + reel link */}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      {conceptLabel ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-accent-tint text-accent font-medium max-w-[120px] truncate">
                          {conceptLabel}
                        </span>
                      ) : (
                        <span className="text-ink-200 text-xs">—</span>
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
                            className="w-full text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-accent rounded px-2 py-1 placeholder-ink-200 text-ink-2 min-w-[90px]"
                          />
                          {linkVal && (
                            <a href={linkVal} target="_blank" rel="noopener noreferrer"
                              title="Open reel" className="text-faint hover:text-accent text-xs flex-shrink-0">↗</a>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  {/* Auto stats from TrackedVideo */}
                  {(["views","likes","shares"] as const).map((f) => (
                    <td key={f} className="px-3 py-2 text-right">
                      <span className={`text-xs font-medium ${auto[f] > 0 ? (isCompare ? "text-accent" : "text-ink-2") : "text-ink-200"}`}>
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
                          <span className={`text-xs font-medium ${v > 0 ? (c.group === "dm" ? "text-info-600" : "text-accent") : "text-ink-200"}`}>
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
                          className="w-full text-right text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-accent rounded px-2 py-1 placeholder-ink-200 min-w-[58px] text-ink-2"
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
              <td className={`px-3 py-2.5 text-xs font-semibold sticky left-0 z-10 ${foot} ${isCompare ? "text-accent" : "text-ink-2"}`}>Total</td>
              <td /><td />
              {(["views","likes","shares"] as const).map((f) => {
                const t = autoSum(ds, f);
                return (
                  <td key={f} className={`px-3 py-2.5 text-right text-xs font-bold ${isCompare ? "text-accent" : "text-ink"}`}>
                    {t > 0 ? fmtN(t) : "—"}
                  </td>
                );
              })}
              {visibleCols.map((c) => {
                const t = manualSum(ds, c.key);
                return (
                  <td key={c.key} className={`px-3 py-2.5 text-right text-xs font-bold ${
                    c.group === "dm" ? "text-info-600" : c.group === "booking" ? "text-accent" : isCompare ? "text-accent" : "text-ink"
                  }`}>{t > 0 ? t : "—"}</td>
                );
              })}
            </tr>
            {/* Rates row */}
            {(showDMs || showBooking) && (ar !== null || lr !== null || br !== null) && (
              <tr className={`border-t border-dashed ${isCompare ? "border-accent-tint" : "border-line"}`}>
                <td className={`px-3 py-1.5 text-xs sticky left-0 z-10 ${isCompare ? "text-accent bg-surface" : "text-faint bg-surface"}`}>Rate</td>
                <td /><td /><td /><td /><td />
                {visibleCols.map((c) => {
                  let rate: string | null = null;
                  if (c.key === "messagesAnswered" && ar !== null) rate = `${ar}% ans.`;
                  if (c.key === "linksSent"        && lr !== null) rate = `${lr}% link`;
                  if (c.key === "bookedCalls"      && br !== null) rate = `${br}% bkd.`;
                  return (
                    <td key={c.key} className="px-3 py-1.5 text-right text-xs">
                      {rate && <span className={`font-medium ${isCompare ? "text-accent" : "text-muted"}`}>{rate}</span>}
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
  // Aggregate the SAME auto-tracked data as General Analytics (per-day views from posted
  // reels), grouped by concept. Compare the current window vs the equally-long window before
  // it for the up/down trajectory. No manual TrackedVideo needed.
  const nowMonday = getMonday(new Date());
  const weekStartsFrom = (offsetWeeks: number) =>
    Array.from({ length: conceptWeeksBack }, (_, i) => getMonday(addDays(nowMonday, -7 * (conceptWeeksBack - 1 - i + offsetWeeks))));
  const datesOf = (starts: Date[]) => { const s = new Set<string>(); for (const ws of starts) for (let i = 0; i < 7; i++) s.add(toYMD(addDays(ws, i))); return s; };

  const curDates = datesOf(weekStartsFrom(0));
  const prevDates = datesOf(weekStartsFrom(conceptWeeksBack)); // the window before the current one
  const conceptAutoMap = buildAutoMap([...curDates, ...prevDates]);

  const conceptLabels = Array.from(new Set(
    [...curDates].flatMap((d) => conceptAutoMap[d]?.concepts || [])
  )).sort();

  // Posted reels behind a concept within a given date window (matched by the day they aired).
  function reelsForConcept(label: string, dates: Set<string> = curDates): any[] {
    return igReels.filter((r) => {
      if (!r.timestamp) return false;
      const ymd = toYMD(new Date(r.timestamp));
      return dates.has(ymd) && conceptAutoMap[ymd]?.concepts.includes(label);
    });
  }
  const avgOf = (reels: any[]) => reels.length ? Math.round(reels.reduce((s, r) => s + (r.plays || 0), 0) / reels.length) : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Analytics</h1>
          <p className="text-muted mt-0.5 text-sm">Auto-populated from calendar · Adjust manually if needed</p>
        </div>
        {client && !tiktokOnly && (
          <div className="flex items-center gap-2">
            {editingBL ? (
              <>
                <input
                  autoFocus value={bookingLink} onChange={(e) => setBookingLink(e.target.value)}
                  placeholder="https://cal.com/..." className="border border-line rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <button onClick={saveBL} className="px-3 py-1.5 bg-accent text-on-accent rounded-lg text-xs font-medium hover:bg-accent-strong">Save</button>
                <button onClick={() => setEditingBL(false)} className="px-3 py-1.5 text-muted hover:bg-surface-3 rounded-lg text-xs">Cancel</button>
              </>
            ) : (
              <button onClick={() => setEditingBL(true)} className="flex items-center gap-1.5 px-3 py-1.5 border border-line rounded-lg text-ink-2 hover:bg-surface-2 text-xs">
                🔗 {bookingLink ? "Edit booking link" : "Add booking link"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-3 rounded-lg p-1 w-fit">
        {(["general", "concept"] as MainTab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink-2"}`}>
            {t === "general" ? "📊 General Analytics" : "💡 Concept Analytics"}
          </button>
        ))}
      </div>

      {/* ── General tab ── */}
      {tab === "general" && (
        <div className="space-y-4">
          {/* TikTok Studio-style analytics (Zernio) — shown for TikTok-connected clients */}
          {client?.tiktokZernioAccountId && (
            <>
              <TikTokStudioAnalytics clientId={client.id} />
              {!tiktokOnly && <div className="border-t border-line pt-1" />}
            </>
          )}
          {!tiktokOnly && (<>
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Period */}
            <div className="flex gap-0.5 bg-surface-3 rounded-lg p-0.5">
              {(["week","2weeks","month"] as Period[]).map((p) => (
                <button key={p} onClick={() => { setPeriod(p); setStartDate(getMonday(new Date())); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${period === p ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink-2"}`}>
                  {p === "week" ? "1 Week" : p === "2weeks" ? "2 Weeks" : "Month"}
                </button>
              ))}
            </div>

            {/* Date nav */}
            <div className="flex items-center bg-surface border border-line rounded-lg overflow-hidden">
              <button onClick={() => setStartDate((d) => addDays(d, -days))} className="px-3 py-2 hover:bg-surface-2 text-muted border-r border-line">‹</button>
              <span className="px-4 text-sm font-medium text-ink-2 whitespace-nowrap">{rangeLabel(startDate, days)}</span>
              <button onClick={() => setStartDate((d) => addDays(d, days))}  className="px-3 py-2 hover:bg-surface-2 text-muted border-l border-line">›</button>
            </div>

            <button onClick={() => setStartDate(getMonday(new Date()))}
              className="px-3 py-2 text-xs border border-line rounded-lg text-muted hover:bg-surface-2 bg-surface">
              Now
            </button>

            <button onClick={() => setCompareMode((v) => !v)}
              className={`px-3 py-2 text-xs rounded-lg border font-medium transition-colors ${compareMode ? "bg-accent text-on-accent border-accent" : "bg-surface border-line text-ink-2 hover:bg-surface-2"}`}>
              ⇔ Compare prev period
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button onClick={() => setShowDMs((v) => !v)}
                className={`px-3 py-1.5 text-xs rounded-lg border font-medium ${showDMs ? "bg-info-50 border-info-200 text-info-700" : "bg-surface border-line text-faint"}`}>
                💬 DMs
              </button>
              <button onClick={() => setShowBooking((v) => !v)}
                className={`px-3 py-1.5 text-xs rounded-lg border font-medium ${showBooking ? "bg-accent-tint border-accent-tint text-accent-strong" : "bg-surface border-line text-faint"}`}>
                📅 Booking
              </button>
            </div>
            {saving && <span className="text-xs text-faint animate-pulse">Saving…</span>}
          </div>

          {!selectedClientId ? (
            <div className="bg-surface rounded-xl border border-line p-12 text-center text-faint text-sm">
              Select a client to view analytics
            </div>
          ) : (
            <div className="space-y-3">
              {/* Legend */}
              <div className="flex items-center gap-4 text-xs text-faint">
                <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-surface-5 inline-block" /> Views/Likes/Shares auto-tracked from videos</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-accent inline-block" /> Concepts auto from scheduled content</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-info-300 inline-block" /> DMs & Booking — enter manually</span>
              </div>

              {renderTable(dates)}

              {compareMode && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center gap-3 text-xs text-accent font-medium">
                    <span className="flex-1 h-px bg-accent-tint" />
                    <span>⇔ Previous period: {rangeLabel(addDays(startDate, -days), days)}</span>
                    <span className="flex-1 h-px bg-accent-tint" />
                  </div>
                  {renderTable(cmpDates, true)}
                </div>
              )}

              {bookingLink && !editingBL && (
                <div className="flex items-center gap-2 text-xs text-faint pt-1">
                  <span>📅</span>
                  <a href={bookingLink} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline truncate max-w-xs">{bookingLink}</a>
                </div>
              )}
            </div>
          )}
          </>)}
        </div>
      )}

      {/* ── Concept Analytics tab ── */}
      {tab === "concept" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-2">Show last</span>
            <select value={conceptWeeksBack} onChange={(e) => setConceptWeeks(parseInt(e.target.value))}
              className="border border-line rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent">
              <option value={1}>1 week</option>
              <option value={2}>2 weeks</option>
              <option value={4}>4 weeks</option>
              <option value={8}>8 weeks</option>
              <option value={12}>12 weeks</option>
            </select>
            <span className="text-xs text-faint">vs the previous {conceptWeeksBack === 1 ? "week" : `${conceptWeeksBack} weeks`}</span>
          </div>

          {!selectedClientId ? (
            <div className="bg-surface rounded-xl border border-line p-12 text-center text-faint text-sm">Select a client</div>
          ) : conceptLabels.length === 0 ? (
            <div className="bg-surface rounded-xl border border-line p-12 text-center text-faint text-sm">
              No concept-tagged posts yet in this window. Once posts go live with a concept, their performance shows here.
            </div>
          ) : (
            <div className="space-y-2">
              {conceptLabels
                .map((label) => {
                  const reels = reelsForConcept(label);
                  const total = reels.reduce((s, r) => s + (r.plays || 0), 0);
                  const avg = avgOf(reels);
                  const prevAvg = avgOf(reelsForConcept(label, prevDates));
                  const delta = prevAvg > 0 && reels.length ? (avg - prevAvg) / prevAvg : null;
                  return { label, reels, total, avg, delta };
                })
                .sort((a, b) => b.avg - a.avg)
                .map(({ label, reels, total, avg, delta }) => (
                  <div key={label} className="flex items-center gap-4 bg-surface border border-line rounded-xl px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink truncate">{label}</p>
                      <p className="text-[11px] text-faint">{reels.length} post{reels.length !== 1 ? "s" : ""} · {fmtN(total)} total views</p>
                    </div>
                    {delta !== null && (
                      <div className={`text-right flex-shrink-0 ${delta >= 0 ? "text-hue-emerald-600" : "text-danger-500"}`}>
                        <p className="text-sm font-bold">{delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(0)}%</p>
                        <p className="text-[10px] text-faint">vs prev</p>
                      </div>
                    )}
                    <div className="text-right flex-shrink-0 w-16">
                      <p className="text-lg font-bold text-ink">{fmtN(avg)}</p>
                      <p className="text-[10px] text-faint">avg / post</p>
                    </div>
                    <button onClick={() => setConceptReels(label)} disabled={!reels.length}
                      className="px-3 py-1.5 text-xs font-semibold text-accent bg-accent-tint rounded-lg hover:bg-accent-tint disabled:opacity-40 flex-shrink-0">
                      🎬 View reels
                    </button>
                  </div>
                ))}
            </div>
          )}

          {conceptReels && (
            <ConceptReelsModal label={conceptReels} reels={reelsForConcept(conceptReels)} onClose={() => setConceptReels(null)} />
          )}
        </div>
      )}
    </div>
  );
}

// Popup showing the posted reels behind one concept, newest first, click to play inline.
function ConceptReelsModal({ label, reels, onClose }: { label: string; reels: any[]; onClose: () => void }) {
  const [play, setPlay] = useState<any | null>(null);
  const [vidErr, setVidErr] = useState(false);
  const sorted = [...reels].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const fmtViews = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + "K" : String(n || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl o-elev-pop w-[640px] max-w-[94vw] max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-line flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-ink">🎬 {label}</h3>
            <p className="text-[11px] text-faint">{sorted.length} posted reel{sorted.length !== 1 ? "s" : ""}</p>
          </div>
          <button onClick={onClose} className="text-faint hover:text-ink-2 text-xl leading-none">×</button>
        </div>
        <div className="p-4 overflow-y-auto">
          {sorted.length === 0 ? (
            <p className="py-12 text-center text-sm text-faint">No reels found for this concept.</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {sorted.map((r) => (
                <button key={r.id} onClick={() => { setVidErr(false); setPlay(r); }}
                  className="relative aspect-[9/16] rounded-lg overflow-hidden border border-line hover:border-accent transition-all group">
                  {r.thumbnail_url
                    ? <img src={r.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full bg-slate-800 flex items-center justify-center text-muted">▶</div>}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  {r.timestamp && <span className="absolute top-1 left-1 text-[8px] text-white bg-black/50 px-1 rounded">{new Date(r.timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                  <span className="absolute bottom-1 left-1 text-[10px] font-bold text-white">▶ {fmtViews(r.plays)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {play && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4" onClick={() => setPlay(null)}>
          <button onClick={() => setPlay(null)} className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 text-white text-lg flex items-center justify-center hover:bg-white/25">×</button>
          {play.media_url ? (
            <video
              src={vidErr ? `/api/vid?u=${encodeURIComponent(play.media_url)}` : play.media_url}
              controls autoPlay playsInline onClick={(e) => e.stopPropagation()}
              onError={() => !vidErr && setVidErr(true)}
              className="max-w-full max-h-full rounded-lg bg-black" />
          ) : (
            <a href={play.permalink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              className="px-4 py-2 bg-surface rounded-lg text-sm font-semibold text-ink-2">Open on Instagram ↗</a>
          )}
        </div>
      )}
    </div>
  );
}
