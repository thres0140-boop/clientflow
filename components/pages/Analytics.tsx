"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Client, Concept, AnalyticsEntry } from "@/lib/types";

type Props = { clients: Client[]; selectedClientId: number | null; refreshClients: () => void };
type MainTab = "general" | "concept";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toYMD(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getWeekDays(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => toYMD(addDays(weekStart, i)));
}

function weekLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const sm = MONTHS[weekStart.getMonth()];
  const em = MONTHS[end.getMonth()];
  return `${sm} ${weekStart.getDate()} – ${em} ${end.getDate()}, ${end.getFullYear()}`;
}

function fmtDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${DAY_NAMES[d.getDay() === 0 ? 6 : d.getDay() - 1]} ${d.getDate()}`;
}

type NumField = "views"|"likes"|"shares"|"follows"|"messagesSent"|"messagesAnswered"|"linksSent"|"bookedCalls";

const METRIC_COLS: { key: NumField; label: string; group?: "dm"|"booking" }[] = [
  { key: "views",            label: "Views" },
  { key: "likes",            label: "Likes" },
  { key: "shares",           label: "Shares" },
  { key: "follows",          label: "Follows" },
  { key: "messagesSent",     label: "Msgs Sent",    group: "dm" },
  { key: "messagesAnswered", label: "Msgs Answered", group: "dm" },
  { key: "linksSent",        label: "Links Sent",   group: "booking" },
  { key: "bookedCalls",      label: "Booked Calls", group: "booking" },
];

type LocalRow = { date: string; conceptId: string } & Record<NumField, string>;

function emptyRow(date: string): LocalRow {
  return { date, conceptId: "", views:"", likes:"", shares:"", follows:"", messagesSent:"", messagesAnswered:"", linksSent:"", bookedCalls:"" };
}

function entryToRow(e: AnalyticsEntry): LocalRow {
  return {
    date: e.date,
    conceptId: e.conceptId ? String(e.conceptId) : "",
    views: e.views ? String(e.views) : "",
    likes: e.likes ? String(e.likes) : "",
    shares: e.shares ? String(e.shares) : "",
    follows: e.follows ? String(e.follows) : "",
    messagesSent: e.messagesSent ? String(e.messagesSent) : "",
    messagesAnswered: e.messagesAnswered ? String(e.messagesAnswered) : "",
    linksSent: e.linksSent ? String(e.linksSent) : "",
    bookedCalls: e.bookedCalls ? String(e.bookedCalls) : "",
  };
}

function sumCol(rows: LocalRow[], key: NumField): number {
  return rows.reduce((s, r) => s + (parseInt(r[key]) || 0), 0);
}

export default function Analytics({ clients, selectedClientId, refreshClients }: Props) {
  const [tab, setTab] = useState<MainTab>("general");
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));
  const [compareMode, setCompareMode] = useState(false);
  const [compareWeekStart, setCompareWeekStart] = useState<Date>(() => getWeekStart(addDays(new Date(), -7)));
  const [showDMs, setShowDMs] = useState(true);
  const [showBooking, setShowBooking] = useState(true);
  const [entries, setEntries] = useState<AnalyticsEntry[]>([]);
  const [compareEntries, setCompareEntries] = useState<AnalyticsEntry[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [rows, setRows] = useState<LocalRow[]>([]);
  const [compareRows, setCompareRows] = useState<LocalRow[]>([]);
  const [bookingLink, setBookingLink] = useState("");
  const [editingBookingLink, setEditingBookingLink] = useState(false);
  const [savingDate, setSavingDate] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Concept Analytics state
  const [conceptWeeksBack, setConceptWeeksBack] = useState(8);
  const [conceptEntries, setConceptEntries] = useState<AnalyticsEntry[]>([]);
  const [conceptWeekStarts, setConceptWeekStarts] = useState<Date[]>([]);

  const client = clients.find((c) => c.id === selectedClientId) ?? null;

  // Sync booking link from client
  useEffect(() => {
    setBookingLink(client?.bookingLink ?? "");
  }, [client]);

  // Load concepts
  useEffect(() => {
    if (!selectedClientId) return;
    fetch(`/api/concepts?clientId=${selectedClientId}&isIdea=false`)
      .then((r) => r.json())
      .then((d) => setConcepts(Array.isArray(d) ? d : []));
  }, [selectedClientId]);

  // Load entries for current week
  const loadWeek = useCallback(async (ws: Date, setter: (e: AnalyticsEntry[]) => void, rowSetter: (rows: LocalRow[]) => void) => {
    if (!selectedClientId) return;
    const days = getWeekDays(ws);
    const from = days[0];
    const to = days[6];
    const data = await fetch(`/api/analytics?clientId=${selectedClientId}&from=${from}&to=${to}`).then((r) => r.json());
    const fetched: AnalyticsEntry[] = Array.isArray(data) ? data : [];
    setter(fetched);
    const entryMap: Record<string, AnalyticsEntry> = {};
    fetched.forEach((e) => { entryMap[e.date] = e; });
    rowSetter(days.map((d) => entryMap[d] ? entryToRow(entryMap[d]) : emptyRow(d)));
  }, [selectedClientId]);

  useEffect(() => {
    loadWeek(weekStart, setEntries, setRows);
  }, [weekStart, selectedClientId, loadWeek]);

  useEffect(() => {
    if (compareMode) loadWeek(compareWeekStart, setCompareEntries, setCompareRows);
  }, [compareMode, compareWeekStart, selectedClientId, loadWeek]);

  // Load concept analytics
  useEffect(() => {
    if (tab !== "concept" || !selectedClientId) return;
    const starts: Date[] = [];
    const now = getWeekStart(new Date());
    for (let i = conceptWeeksBack - 1; i >= 0; i--) {
      starts.push(getWeekStart(addDays(now, -7 * i)));
    }
    setConceptWeekStarts(starts);
    const from = toYMD(starts[0]);
    const to = toYMD(addDays(starts[starts.length - 1], 6));
    fetch(`/api/analytics?clientId=${selectedClientId}&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => setConceptEntries(Array.isArray(d) ? d : []));
  }, [tab, selectedClientId, conceptWeeksBack]);

  function handleCellChange(rowIdx: number, field: keyof LocalRow, value: string, isCompare = false) {
    if (isCompare) {
      setCompareRows((prev) => prev.map((r, i) => i === rowIdx ? { ...r, [field]: value } : r));
    } else {
      setRows((prev) => prev.map((r, i) => i === rowIdx ? { ...r, [field]: value } : r));
    }
  }

  function scheduleSave(rowIdx: number, isCompare = false) {
    const key = `${isCompare ? "c" : ""}${rowIdx}`;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(() => saveRow(rowIdx, isCompare), 600);
  }

  async function saveRow(rowIdx: number, isCompare = false) {
    if (!selectedClientId) return;
    const row = isCompare ? compareRows[rowIdx] : rows[rowIdx];
    if (!row) return;

    // Don't save if all fields are empty
    const hasData = METRIC_COLS.some((c) => row[c.key] !== "") || row.conceptId !== "";
    if (!hasData) return;

    setSavingDate(row.date);
    try {
      await fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClientId,
          date: row.date,
          conceptId: row.conceptId || null,
          views: row.views || 0,
          likes: row.likes || 0,
          shares: row.shares || 0,
          follows: row.follows || 0,
          messagesSent: row.messagesSent || 0,
          messagesAnswered: row.messagesAnswered || 0,
          linksSent: row.linksSent || 0,
          bookedCalls: row.bookedCalls || 0,
        }),
      });
    } finally {
      setSavingDate(null);
    }
  }

  async function saveBookingLink() {
    if (!client) return;
    await fetch(`/api/clients/${client.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...client, bookingLink }),
    });
    setEditingBookingLink(false);
    refreshClients();
  }

  const visibleCols = METRIC_COLS.filter((c) => {
    if (c.group === "dm" && !showDMs) return false;
    if (c.group === "booking" && !showBooking) return false;
    return true;
  });

  const weekDays = getWeekDays(weekStart);
  const compareWeekDays = getWeekDays(compareWeekStart);

  const totals = Object.fromEntries(visibleCols.map((c) => [c.key, sumCol(rows, c.key)])) as Record<NumField, number>;
  const compareTotals = Object.fromEntries(visibleCols.map((c) => [c.key, sumCol(compareRows, c.key)])) as Record<NumField, number>;

  const answerRate = totals.messagesSent > 0 ? Math.round((totals.messagesAnswered / totals.messagesSent) * 100) : null;
  const bookingRate = totals.linksSent > 0 ? Math.round((totals.bookedCalls / totals.linksSent) * 100) : null;
  const cmpAnswerRate = compareTotals.messagesSent > 0 ? Math.round((compareTotals.messagesAnswered / compareTotals.messagesSent) * 100) : null;
  const cmpBookingRate = compareTotals.linksSent > 0 ? Math.round((compareTotals.bookedCalls / compareTotals.linksSent) * 100) : null;

  function deltaClass(a: number, b: number) {
    if (a > b) return "text-green-600";
    if (a < b) return "text-red-500";
    return "text-slate-400";
  }
  function deltaArrow(a: number, b: number) {
    if (a > b) return "↑";
    if (a < b) return "↓";
    return "–";
  }

  // ── Concept Analytics helpers ──────────────────────────────────────────
  const conceptsWithData = concepts.filter((c) =>
    conceptEntries.some((e) => e.conceptId === c.id)
  );

  function weekViews(conceptId: number, ws: Date): number {
    const days = getWeekDays(ws);
    return conceptEntries
      .filter((e) => e.conceptId === conceptId && days.includes(e.date))
      .reduce((s, e) => s + e.views, 0);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Analytics</h1>
          <p className="text-slate-500 mt-0.5 text-sm">Track daily performance and concept results</p>
        </div>
        {/* Booking link */}
        {client && (
          <div className="flex items-center gap-2 text-sm">
            {editingBookingLink ? (
              <>
                <input
                  autoFocus
                  value={bookingLink}
                  onChange={(e) => setBookingLink(e.target.value)}
                  placeholder="https://cal.com/..."
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button onClick={saveBookingLink} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700">Save</button>
                <button onClick={() => setEditingBookingLink(false)} className="px-3 py-1.5 text-slate-500 hover:bg-slate-100 rounded-lg text-xs">Cancel</button>
              </>
            ) : (
              <button
                onClick={() => setEditingBookingLink(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 text-xs"
              >
                🔗 {bookingLink ? "Edit booking link" : "Add booking link"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Main tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {(["general", "concept"] as MainTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {t === "general" ? "📊 General Analytics" : "💡 Concept Analytics"}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <div className="space-y-4">
          {/* Controls bar */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Week navigation */}
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setWeekStart((w) => getWeekStart(addDays(w, -7)))}
                className="px-3 py-2 hover:bg-slate-50 text-slate-600 border-r border-slate-200"
              >‹</button>
              <span className="px-4 py-2 text-sm font-medium text-slate-700 whitespace-nowrap">{weekLabel(weekStart)}</span>
              <button
                onClick={() => setWeekStart((w) => getWeekStart(addDays(w, 7)))}
                className="px-3 py-2 hover:bg-slate-50 text-slate-600 border-l border-slate-200"
              >›</button>
            </div>

            <button
              onClick={() => setWeekStart(getWeekStart(new Date()))}
              className="px-3 py-2 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 bg-white"
            >
              This week
            </button>

            {/* Compare toggle */}
            <button
              onClick={() => setCompareMode((v) => !v)}
              className={`px-3 py-2 text-xs rounded-lg border font-medium transition-colors ${compareMode ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              ⇔ Compare
            </button>

            <div className="ml-auto flex items-center gap-2">
              {/* DMs toggle */}
              <button
                onClick={() => setShowDMs((v) => !v)}
                className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${showDMs ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-slate-200 text-slate-400"}`}
              >
                💬 DMs
              </button>
              {/* Booking toggle */}
              <button
                onClick={() => setShowBooking((v) => !v)}
                className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${showBooking ? "bg-purple-50 border-purple-200 text-purple-700" : "bg-white border-slate-200 text-slate-400"}`}
              >
                📅 Booking
              </button>
            </div>

            {savingDate && (
              <span className="text-xs text-slate-400 animate-pulse">Saving…</span>
            )}
          </div>

          {/* Compare week picker */}
          {compareMode && (
            <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2">
              <span className="text-xs font-medium text-indigo-600">Comparing with:</span>
              <div className="flex items-center gap-1 bg-white border border-indigo-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setCompareWeekStart((w) => getWeekStart(addDays(w, -7)))}
                  className="px-3 py-1.5 hover:bg-slate-50 text-slate-600 border-r border-indigo-200 text-sm"
                >‹</button>
                <span className="px-3 py-1.5 text-xs font-medium text-slate-700">{weekLabel(compareWeekStart)}</span>
                <button
                  onClick={() => setCompareWeekStart((w) => getWeekStart(addDays(w, 7)))}
                  className="px-3 py-1.5 hover:bg-slate-50 text-slate-600 border-l border-indigo-200 text-sm"
                >›</button>
              </div>
            </div>
          )}

          {/* Spreadsheet table */}
          {!selectedClientId ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
              Select a client to view analytics
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="text-sm min-w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 sticky left-0 bg-slate-50 z-10 min-w-[80px]">Day</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500 min-w-[140px]">Concept</th>
                    {visibleCols.map((c) => (
                      <th key={c.key} className={`px-3 py-2.5 text-right text-xs font-semibold whitespace-nowrap ${c.group === "dm" ? "text-blue-600" : c.group === "booking" ? "text-purple-600" : "text-slate-500"}`}>
                        {c.label}
                      </th>
                    ))}
                    {compareMode && (
                      <>
                        <th className="px-2 py-2.5 w-4 bg-indigo-50/50" />
                        {visibleCols.map((c) => (
                          <th key={`cmp-${c.key}`} className={`px-3 py-2.5 text-right text-xs font-semibold whitespace-nowrap bg-indigo-50/40 ${c.group === "dm" ? "text-blue-500" : c.group === "booking" ? "text-purple-500" : "text-indigo-400"}`}>
                            {c.label} ②
                          </th>
                        ))}
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row, idx) => {
                    const cmpRow = compareRows[idx];
                    return (
                      <tr key={row.date} className="hover:bg-slate-50/60 group">
                        <td className="px-3 py-2 sticky left-0 bg-white group-hover:bg-slate-50/60 z-10">
                          <span className="font-medium text-slate-700">{fmtDay(row.date)}</span>
                        </td>
                        {/* Concept selector */}
                        <td className="px-2 py-1.5">
                          <select
                            value={row.conceptId}
                            onChange={(e) => { handleCellChange(idx, "conceptId", e.target.value); scheduleSave(idx); }}
                            className="w-full text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-1 py-1 text-slate-600 cursor-pointer"
                          >
                            <option value="">—</option>
                            {concepts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </td>
                        {visibleCols.map((c) => (
                          <td key={c.key} className="px-1.5 py-1.5">
                            <input
                              type="number"
                              min="0"
                              value={row[c.key]}
                              onChange={(e) => { handleCellChange(idx, c.key, e.target.value); scheduleSave(idx); }}
                              placeholder="—"
                              className="w-full text-right text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-2 py-1 text-slate-700 placeholder-slate-300 min-w-[60px]"
                            />
                          </td>
                        ))}
                        {compareMode && cmpRow && (
                          <>
                            <td className="bg-indigo-50/30 w-2" />
                            {visibleCols.map((c) => (
                              <td key={`cmp-${c.key}`} className="px-1.5 py-1.5 bg-indigo-50/20">
                                <input
                                  type="number"
                                  min="0"
                                  value={cmpRow[c.key]}
                                  onChange={(e) => { handleCellChange(idx, c.key, e.target.value, true); scheduleSave(idx, true); }}
                                  placeholder="—"
                                  className="w-full text-right text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-300 rounded px-2 py-1 text-indigo-500 placeholder-indigo-200 min-w-[60px]"
                                />
                              </td>
                            ))}
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
                {/* Totals */}
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-semibold">
                    <td className="px-3 py-2.5 text-xs text-slate-600 sticky left-0 bg-slate-50">Total</td>
                    <td className="px-3 py-2.5" />
                    {visibleCols.map((c) => (
                      <td key={c.key} className="px-3 py-2.5 text-right text-xs text-slate-800 font-semibold">
                        {totals[c.key] || "—"}
                      </td>
                    ))}
                    {compareMode && (
                      <>
                        <td className="bg-indigo-50/30" />
                        {visibleCols.map((c) => {
                          const diff = totals[c.key] - compareTotals[c.key];
                          return (
                            <td key={`cmp-${c.key}`} className="px-3 py-2.5 text-right text-xs bg-indigo-50/20">
                              <span className="text-indigo-600 font-semibold">{compareTotals[c.key] || "—"}</span>
                              {compareTotals[c.key] > 0 && totals[c.key] > 0 && (
                                <span className={`ml-1 text-[10px] font-bold ${deltaClass(totals[c.key], compareTotals[c.key])}`}>
                                  {deltaArrow(totals[c.key], compareTotals[c.key])}{Math.abs(diff)}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </>
                    )}
                  </tr>
                  {/* Rates row */}
                  {(showDMs || showBooking) && (
                    <tr className="border-t border-slate-100 bg-slate-50/60">
                      <td className="px-3 py-2 text-xs text-slate-400 sticky left-0 bg-slate-50/60">Rate</td>
                      <td className="px-3 py-2" />
                      {visibleCols.map((c) => {
                        let rate: string | null = null;
                        if (c.key === "messagesAnswered" && showDMs && answerRate !== null) rate = `${answerRate}% ans.`;
                        if (c.key === "bookedCalls" && showBooking && bookingRate !== null) rate = `${bookingRate}% bkd.`;
                        return (
                          <td key={c.key} className="px-3 py-2 text-right text-xs">
                            {rate ? <span className="text-slate-500 font-medium">{rate}</span> : null}
                          </td>
                        );
                      })}
                      {compareMode && (
                        <>
                          <td className="bg-indigo-50/30" />
                          {visibleCols.map((c) => {
                            let rate: string | null = null;
                            if (c.key === "messagesAnswered" && showDMs && cmpAnswerRate !== null) rate = `${cmpAnswerRate}%`;
                            if (c.key === "bookedCalls" && showBooking && cmpBookingRate !== null) rate = `${cmpBookingRate}%`;
                            return (
                              <td key={`cmp-${c.key}`} className="px-3 py-2 text-right text-xs bg-indigo-50/20">
                                {rate ? <span className="text-indigo-400 font-medium">{rate}</span> : null}
                              </td>
                            );
                          })}
                        </>
                      )}
                    </tr>
                  )}
                </tfoot>
              </table>
            </div>
          )}

          {/* Booking link display */}
          {bookingLink && !editingBookingLink && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>📅 Booking link:</span>
              <a href={bookingLink} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline truncate max-w-xs">{bookingLink}</a>
            </div>
          )}
        </div>
      )}

      {tab === "concept" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">Show last</span>
            {[4, 8, 12].map((n) => (
              <button
                key={n}
                onClick={() => setConceptWeeksBack(n)}
                className={`px-3 py-1.5 text-xs rounded-lg border font-medium ${conceptWeeksBack === n ? "bg-indigo-600 text-white border-indigo-600" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
              >
                {n} weeks
              </button>
            ))}
          </div>

          {!selectedClientId ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
              Select a client to view concept analytics
            </div>
          ) : conceptsWithData.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-sm">
              No concept data yet. Assign concepts to days in the General tab to see weekly performance.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="text-sm min-w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 sticky left-0 bg-slate-50 min-w-[160px]">Concept</th>
                    {conceptWeekStarts.map((ws, i) => (
                      <th key={i} className="px-3 py-3 text-right text-xs font-semibold text-slate-400 whitespace-nowrap min-w-[80px]">
                        {MONTHS[ws.getMonth()]} {ws.getDate()}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {conceptsWithData.map((concept) => (
                    <tr key={concept.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-medium text-slate-700 sticky left-0 bg-white hover:bg-slate-50/60">{concept.name}</td>
                      {conceptWeekStarts.map((ws, i) => {
                        const views = weekViews(concept.id, ws);
                        const prevViews = i > 0 ? weekViews(concept.id, conceptWeekStarts[i - 1]) : null;
                        const delta = prevViews !== null ? views - prevViews : null;
                        return (
                          <td key={i} className="px-3 py-3 text-right">
                            {views > 0 ? (
                              <div className="inline-flex flex-col items-end">
                                <span className="text-xs font-semibold text-slate-700">
                                  {views >= 1000 ? `${(views / 1000).toFixed(1)}K` : views}
                                </span>
                                {delta !== null && delta !== 0 && (
                                  <span className={`text-[10px] font-bold leading-none mt-0.5 ${delta > 0 ? "text-green-500" : "text-red-400"}`}>
                                    {delta > 0 ? "↑" : "↓"}{Math.abs(delta) >= 1000 ? `${(Math.abs(delta)/1000).toFixed(1)}K` : Math.abs(delta)}
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
