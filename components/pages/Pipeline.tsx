"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Client, ContentPiece, Concept, WorkflowStage, TeamMember, ScriptDraft,
  STATUSES, PLATFORMS, CONTENT_TYPES,
} from "@/lib/types";
import StatusBadge from "@/components/ui/StatusBadge";
import ClientAvatar from "@/components/ui/ClientAvatar";
import Modal from "@/components/ui/Modal";

type Props = {
  clients: Client[];
  selectedClientId: number | null;
  refreshClients: () => void;
  refreshNotifications: () => void;
  isClient?: boolean;
  readOnly?: boolean; // view-only: can see the page but not add/schedule/edit
};

type CalendarView = "month" | "week";
type PlanningMode = "calendar" | "template";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CONTENT_ICONS: Record<string, string> = {
  video: "🎬", photo: "📷", carousel: "📱", reel: "🎞️", story: "⭕",
};

// Local YYYY-MM-DD — NOT toISOString(), which shifts to UTC and slips the date back
// a day in east-of-UTC timezones (e.g. Amsterdam), misaligning the calendar.
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMonthGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const days: (string | null)[] = Array(startOffset).fill(null);
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(ymdLocal(new Date(year, month, d)));
  }
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function getWeekDays(baseDate: Date, weekOffset: number): string[] {
  const d = new Date(baseDate);
  const day = d.getDay();
  const mondayDiff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayDiff + weekOffset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(d);
    dd.setDate(d.getDate() + i);
    return ymdLocal(dd);
  });
}

function parseDayTemplate(raw: string | null | undefined): Record<number, number | null> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export default function Pipeline({ clients, selectedClientId, refreshNotifications, isClient, readOnly = false }: Props) {
  // Editing is allowed unless the page is view-only for this member.
  const canEdit = !readOnly;
  const [content, setContent] = useState<ContentPiece[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  // Label a concept as "General Concept · Concept Type" (falls back to just the name).
  // Looks up the full concept (for conceptType) since embedded objects only carry the name.
  const conceptLabel = (conceptId?: number | null, fallbackName?: string | null) => {
    const full = conceptId ? concepts.find((c) => c.id === conceptId) : null;
    const name = full?.name ?? fallbackName ?? "";
    const cat = full?.conceptType;
    if (cat) return `${cat} · ${name}`;
    if (name) return name;
    // Concept set but not in the loaded list yet (e.g. just created) — never show blank.
    return conceptId ? "Concept" : "";
  };

  // Calendar item colour by lifecycle:
  //  red    = planned but not yet in the Schedule stage (not ready)
  //  orange = in the Schedule stage but auto-post not confirmed
  //  blue   = confirmed / booked to auto-post
  //  green  = posted
  function draftState(d: ScriptDraft): { key: "planned" | "ready" | "booked" | "posted"; color: string; label: string } {
    const lastStageId = stages.length ? stages[stages.length - 1].id : null;
    if (d.status === "posted") return { key: "posted", color: "#16a34a", label: "Posted" };
    if (d.zernioBooked) return { key: "booked", color: "#2563eb", label: "Scheduled" };
    if (lastStageId != null && d.stageId === lastStageId) return { key: "ready", color: "#f97316", label: "Ready · tap to confirm" };
    return { key: "planned", color: "#ef4444", label: "Planned · not in Schedule yet" };
  }
  const [stages, setStages] = useState<WorkflowStage[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [scheduledDrafts, setScheduledDrafts] = useState<ScriptDraft[]>([]);
  const [stagedDrafts, setStagedDrafts] = useState<ScriptDraft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<ScriptDraft | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showPostIG, setShowPostIG] = useState(false);
  const [selected, setSelected] = useState<ContentPiece | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [dragDraftId, setDragDraftId] = useState<number | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [showScheduleBoard, setShowScheduleBoard] = useState(true);
  const [pendingDrop, setPendingDrop] = useState<{ draft: ScriptDraft; date: string } | null>(null);
  const [planDrop, setPlanDrop] = useState<{ draftId: number; date: string } | null>(null);
  const [boardColumnPicker, setBoardColumnPicker] = useState(false);
  const [boardColumns, setBoardColumns] = useState<string[]>(["Ideas"]);

  const [calView, setCalView] = useState<CalendarView>(() => {
    if (typeof window !== "undefined") {
      const v = localStorage.getItem("cf_cal_view");
      if (v === "week" || v === "month") return v;
    }
    return "month";
  });
  useEffect(() => { localStorage.setItem("cf_cal_view", calView); }, [calView]);
  const [planMode, setPlanMode] = useState<PlanningMode>("calendar");
  const [offset, setOffset] = useState(0);
  const [openDatePicker, setOpenDatePicker] = useState<string | null>(null);
  const [openTemplateDay, setOpenTemplateDay] = useState<number | null>(null);
  const [dateTags, setDateTags] = useState<Record<string, number>>({});

  const today = new Date();
  const todayStr = ymdLocal(today);

  // Month view
  const viewDate = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();
  const monthGrid = getMonthGrid(viewYear, viewMonth);

  // Week view
  const weekDays = getWeekDays(today, offset);
  const weekLabel = (() => {
    const start = new Date(weekDays[0]);
    const end = new Date(weekDays[6]);
    if (start.getMonth() === end.getMonth())
      return `${start.getDate()}–${end.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
    return `${start.getDate()} ${MONTHS[start.getMonth()]} – ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
  })();

  const activeClient = clients.find((c) => c.id === selectedClientId) ?? null;
  const [dayTemplate, setDayTemplate] = useState<Record<number, number | null>>({});

  const reload = useCallback(async () => {
    const qs = selectedClientId ? `?clientId=${selectedClientId}` : "";
    const [c, co, s, t, allDrafts] = await Promise.all([
      fetch(`/api/content${qs}`).then((r) => r.json()),
      fetch(`/api/concepts${selectedClientId ? `?clientId=${selectedClientId}` : ""}`).then((r) => r.json()),
      fetch(`/api/workflow${selectedClientId ? `?clientId=${selectedClientId}` : ""}`).then((r) => r.json()),
      fetch(selectedClientId ? `/api/team?clientId=${selectedClientId}` : "/api/team").then((r) => r.json()),
      selectedClientId ? fetch(`/api/script-drafts?clientId=${selectedClientId}&all=true`).then((r) => r.json()) : Promise.resolve([]),
    ]);
    setContent(c);
    setConcepts(co.filter((c: Concept) => !c.isIdea));
    setStages(s);
    setTeam(t);
    const allStaged: ScriptDraft[] = allDrafts || [];
    setStagedDrafts(allStaged);
    setScheduledDrafts(allStaged.filter((d: ScriptDraft) => d.scheduledDate));
  }, [selectedClientId]);

  useEffect(() => { reload(); }, [reload]);

  // Restore per-client settings from localStorage when client changes
  useEffect(() => {
    if (!selectedClientId) return;
    const savedMode = localStorage.getItem(`cf_plan_mode_${selectedClientId}`) as PlanningMode | null;
    if (savedMode === "calendar" || savedMode === "template") setPlanMode(savedMode);
    else setPlanMode("calendar");
    const savedTags = localStorage.getItem(`cf_date_tags_${selectedClientId}`);
    setDateTags(savedTags ? JSON.parse(savedTags) : {});
    const savedCols = localStorage.getItem(`cf_board_cols_${selectedClientId}`);
    setBoardColumns(savedCols ? JSON.parse(savedCols) : ["Ideas"]);
  }, [selectedClientId]);

  useEffect(() => {
    if (activeClient) setDayTemplate(parseDayTemplate(activeClient.dayTemplate));
    else setDayTemplate({});
  }, [activeClient]);

  function changePlanMode(mode: PlanningMode) {
    setPlanMode(mode);
    if (selectedClientId) localStorage.setItem(`cf_plan_mode_${selectedClientId}`, mode);
  }

  function setDateTag(date: string, conceptId: number | null) {
    const updated = { ...dateTags };
    if (conceptId === null) delete updated[date];
    else updated[date] = conceptId;
    setDateTags(updated);
    if (selectedClientId) localStorage.setItem(`cf_date_tags_${selectedClientId}`, JSON.stringify(updated));
    setOpenDatePicker(null);
  }

  async function saveDayTemplate(updated: Record<number, number | null>) {
    if (!activeClient) return;
    setDayTemplate(updated);
    await fetch(`/api/clients/${activeClient.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...activeClient, dayTemplate: JSON.stringify(updated) }),
    });
  }

  async function scheduleDraftOnDate(draftId: number, date: string) {
    await fetch(`/api/script-drafts/${draftId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: date }),
    });
    reload();
  }

  async function unscheduleDraft(draftId: number) {
    await fetch(`/api/script-drafts/${draftId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: null, zernioBooked: false }),
    });
    reload();
  }

  function handleDraftDragStart(draftId: number) {
    setDragDraftId(draftId);
  }

  // Dropping a draft onto a date is just PLANNING — but ask for a time first
  // (so nothing is silently set to 9am). Confirming the auto-post stays a
  // separate deliberate step (click the planned chip → "Confirm scheduling").
  function handleCalendarDrop(date: string) {
    const id = dragDraftId;
    setDragDraftId(null);
    setDragOverDate(null);
    if (!id) return;
    // If it's already on the calendar, this is a day move → keep the same time,
    // just change the day (no time prompt). Otherwise (from the board) ask for a time.
    const existing = stagedDrafts.find((d) => d.id === id);
    if (existing?.scheduledDate) {
      if (existing.scheduledDate.startsWith(date)) return; // dropped on the same day → no-op
      const m = existing.scheduledDate.match(/T(\d{2}:\d{2})/);
      scheduleDraftOnDate(id, m ? `${date}T${m[1]}` : date);
    } else {
      setPlanDrop({ draftId: id, date });
    }
  }

  async function deleteContent(id: number) {
    if (!confirm("Delete this content piece?")) return;
    await fetch(`/api/content/${id}`, { method: "DELETE" });
    setSelected(null);
    reload();
  }

  async function updateStatus(id: number, status: string) {
    const piece = content.find((c) => c.id === id);
    if (!piece) return;
    await fetch(`/api/content/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...piece, status }),
    });
    setSelected((prev) => prev ? { ...prev, status } : null);
    reload();
  }

  async function advanceStage(contentId: number, stageId: number, completedById?: number, notes?: string, rawContentUrl?: string) {
    await fetch("/api/stage-advance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentId, stageId, completedById, notes, rawContentUrl }),
    });
    setSelected(null);
    reload();
    refreshNotifications();
  }

  const filteredContent = filterStatus === "all" ? content : content.filter((c) => c.status === filterStatus);

  function calendarHeader() {
    if (calView === "month") return `${MONTHS[viewMonth]} ${viewYear}`;
    return weekLabel;
  }

  function calendarPrev() { setOffset((o) => o - 1); }
  function calendarNext() { setOffset((o) => o + 1); }
  function calendarToday() { setOffset(0); }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Content Pipeline</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {activeClient ? activeClient.name : "All clients"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && <PlanModeSelector current={planMode} onChange={changePlanMode} />}
          {canEdit && (
            <>
              <button
                onClick={() => setShowPostIG(true)}
                className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity flex items-center gap-1.5"
              >
                <span>📸</span> Post to Instagram
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
              >
                + Add Content
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── CALENDAR (both modes share the same view) ────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {/* Calendar toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-800">{calendarHeader()}</h2>
            <div className="flex items-center bg-slate-100 rounded-md p-0.5 text-xs">
              <button
                onClick={() => { setCalView("month"); setOffset(0); }}
                className={`px-2.5 py-1 rounded transition-all ${calView === "month" ? "bg-white text-slate-700 shadow-sm font-medium" : "text-slate-400"}`}
              >
                Month
              </button>
              <button
                onClick={() => { setCalView("week"); setOffset(0); }}
                className={`px-2.5 py-1 rounded transition-all ${calView === "week" ? "bg-white text-slate-700 shadow-sm font-medium" : "text-slate-400"}`}
              >
                Week
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={calendarPrev} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500">‹</button>
            <button onClick={calendarToday} className="px-2.5 h-7 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-lg">Today</button>
            <button onClick={calendarNext} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500">›</button>
          </div>
        </div>

        {/* Day headers — in template mode each header gets a concept picker */}
        <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
          {DAYS.map((d, i) => {
            const conceptId = dayTemplate[i] ?? null;
            return (
              <div key={d} className="border-r border-slate-100 last:border-r-0 px-2 py-2">
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-400">{d}</span>
                  {planMode === "template" && canEdit && (
                    conceptId ? (
                      <button
                        onClick={() => saveDayTemplate({ ...dayTemplate, [i]: null })}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium text-white hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: "#6366f1" }}
                        title="Click to remove"
                      >
                        <span className="truncate max-w-[90px]">{conceptLabel(conceptId)}</span>
                        <span className="opacity-70">×</span>
                      </button>
                    ) : (
                      <div className="relative">
                        <button onClick={() => setOpenTemplateDay(openTemplateDay === i ? null : i)}
                          className="w-4 h-4 rounded-full bg-slate-200 hover:bg-indigo-500 text-slate-500 hover:text-white text-[10px] font-bold flex items-center justify-center transition-colors leading-none">
                          +
                        </button>
                        {openTemplateDay === i && (
                          <>
                            {/* click-away backdrop */}
                            <div className="fixed inset-0 z-10" onClick={() => setOpenTemplateDay(null)} />
                            <div className="absolute top-5 left-0 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[160px] max-h-64 overflow-y-auto">
                              {concepts.length === 0 ? (
                                <p className="px-3 py-2 text-xs text-slate-400">No concepts yet</p>
                              ) : concepts.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => { saveDayTemplate({ ...dayTemplate, [i]: c.id }); setOpenTemplateDay(null); }}
                                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                                >
                                  {conceptLabel(c.id, c.name)}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {calView === "month" ? (
            <div className="grid grid-cols-7">
              {monthGrid.map((date, idx) => {
                const pieces = date ? content.filter((c) => c.scheduledDate?.startsWith(date)) : [];
                const draftsOnDay = date ? scheduledDrafts.filter((d) => d.scheduledDate?.startsWith(date)) : [];
                const isToday = date === todayStr;
                const isDragTarget = date !== null && date === dragOverDate && dragDraftId !== null;
                const dow = date ? (new Date(date + "T00:00:00").getDay() + 6) % 7 : -1; // 0=Mon (parse local, not UTC)
                const templateConceptId = dow >= 0 ? dayTemplate[dow] : null;
                const templateConcept = templateConceptId ? concepts.find((c) => c.id === templateConceptId) : null;
                return (
                  <div
                    key={idx}
                    className={`min-h-[100px] border-r border-b border-slate-100 last:border-r-0 p-1.5 transition-colors ${isToday ? "bg-indigo-50/40" : ""} ${!date ? "bg-slate-50/50" : ""} ${isDragTarget ? "bg-indigo-100/60 ring-2 ring-inset ring-indigo-400" : ""}`}
                    onDragOver={date && canEdit ? (e) => { e.preventDefault(); setDragOverDate(date); } : undefined}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={date && canEdit ? () => handleCalendarDrop(date) : undefined}
                  >
                    {date && (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-indigo-600 text-white" : "text-slate-500"}`}>
                            {date.slice(8).replace(/^0/, "")}
                          </span>
                          {/* Calendar mode: tag picker per individual date */}
                          {canEdit && planMode === "calendar" && (() => {
                            const tagId = dateTags[date];
                            const tagConcept = tagId ? concepts.find((c) => c.id === tagId) : null;
                            return tagConcept ? (
                              <button
                                onClick={() => setDateTag(date, null)}
                                className="text-[9px] px-1 py-0.5 rounded font-medium text-white hover:opacity-70 truncate max-w-[60px]"
                                style={{ backgroundColor: "#6366f1" }}
                                title="Click to remove tag"
                              >
                                {conceptLabel(tagConcept.id, tagConcept.name)}
                              </button>
                            ) : (
                              <div className="relative">
                                <button
                                  onClick={() => setOpenDatePicker(openDatePicker === date ? null : date)}
                                  className="w-4 h-4 rounded-full bg-slate-100 hover:bg-indigo-100 text-slate-400 hover:text-indigo-600 text-[10px] font-bold flex items-center justify-center transition-colors"
                                >
                                  +
                                </button>
                                {openDatePicker === date && (
                                  <div className="absolute top-5 right-0 z-30 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[150px]">
                                    {concepts.length === 0 ? (
                                      <p className="px-3 py-2 text-xs text-slate-400">No concepts yet</p>
                                    ) : concepts.map((c) => (
                                      <button
                                        key={c.id}
                                        onClick={() => setDateTag(date, c.id)}
                                        className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                                      >
                                        {conceptLabel(c.id, c.name)}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        {/* Template hint (faint, only in template mode) */}
                        {planMode === "template" && templateConcept && pieces.length === 0 && (
                          <div className="mb-1 px-1.5 py-0.5 rounded text-[9px] text-slate-400 border border-dashed border-slate-200 truncate">
                            💡 {conceptLabel(templateConcept.id, templateConcept.name)}
                          </div>
                        )}
                        <div className="space-y-1">
                          {pieces.slice(0, 3).map((piece) => {
                            const isPosted = piece.status === "posted" || !!piece.igMediaId;
                            return (
                              <button
                                key={piece.id}
                                onClick={() => setSelected(piece)}
                                className="w-full text-left rounded-md px-1.5 py-1 text-[10px] font-medium leading-tight hover:opacity-90 transition-opacity truncate"
                                style={isPosted ? {
                                  backgroundColor: "#dcfce7",
                                  borderLeft: "2px solid #16a34a",
                                  color: "#15803d",
                                } : {
                                  backgroundColor: (piece.client?.color || "#6366f1") + "20",
                                  borderLeft: `2px solid ${piece.client?.color || "#6366f1"}`,
                                  color: "#1e293b",
                                }}
                              >
                                <div className="truncate">{piece.title}</div>
                                {isPosted && <div className="text-[8px] font-semibold text-green-600 mt-0.5">✓ Posted</div>}
                              </button>
                            );
                          })}
                          {pieces.length > 3 && (
                            <p className="text-[9px] text-slate-400 pl-1">+{pieces.length - 3} more</p>
                          )}
                          {draftsOnDay.map((draft) => {
                            const st = draftState(draft);
                            const solid = st.key === "booked" || st.key === "posted";
                            // Only planning-stage cards can be dragged between days; booked/posted
                            // are locked (moving them would desync the live Zernio booking).
                            const movable = canEdit && (st.key === "planned" || st.key === "ready");
                            return (
                            <div
                              key={`d-${draft.id}`}
                              draggable={movable}
                              onDragStart={movable ? () => handleDraftDragStart(draft.id) : undefined}
                              onDragEnd={() => { setDragDraftId(null); setDragOverDate(null); }}
                              className={`w-full rounded-md px-1.5 py-1 text-[10px] font-medium leading-tight group/draft relative ${movable ? "cursor-grab active:cursor-grabbing" : ""}`}
                              style={solid
                                ? { backgroundColor: st.color, color: "#fff" }
                                : { backgroundColor: st.color + "15", borderLeft: `2px solid ${st.color}`, color: "#1e293b" }}
                            >
                              <button onClick={() => (!canEdit || solid) ? setSelectedDraft(draft) : setPendingDrop({ draft, date })} className="w-full text-left" title={st.label}>
                                <div className="truncate font-semibold pr-4">{st.key === "booked" ? "🔒 " : st.key === "posted" ? "✓ " : ""}{draft.title}</div>
                                {draft.concept && <div className={`truncate text-[9px] ${solid ? "text-white/80" : "opacity-70"}`}>💡 {conceptLabel(draft.conceptId, draft.concept.name)}</div>}
                                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                  {(() => { const t = draft.scheduledDate?.match(/T(\d{2}:\d{2})/)?.[1]; return t ? <span className={`rounded px-1 text-[9px] font-semibold ${solid ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>🕐 {t}</span> : null; })()}
                                  {!solid && <span className="rounded px-1 text-[9px]" style={{ backgroundColor: st.color + "22", color: st.color }}>{st.label}</span>}
                                  {draft.stage && <span className={`rounded px-1 text-[9px] ${solid ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>📍 {draft.stage.name}</span>}
                                </div>
                              </button>
                              <button
                                onClick={() => unscheduleDraft(draft.id)}
                                className={`absolute top-0.5 right-0.5 opacity-0 group-hover/draft:opacity-100 transition-all leading-none text-[11px] w-4 h-4 flex items-center justify-center ${solid ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-red-500"}`}
                                title="Remove from calendar"
                              >×</button>
                            </div>
                          );})}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Week view */
            <div className="grid grid-cols-7 divide-x divide-slate-100">
              {weekDays.map((date, i) => {
                const pieces = content.filter((c) => c.scheduledDate?.startsWith(date));
                const draftsOnDay = scheduledDrafts.filter((d) => d.scheduledDate?.startsWith(date));
                const isToday = date === todayStr;
                const isDragTargetWeek = date === dragOverDate && dragDraftId !== null;
                const templateConceptId = dayTemplate[i];
                const templateConcept = templateConceptId ? concepts.find((c) => c.id === templateConceptId) : null;
                const d = new Date(date);
                return (
                  <div
                    key={date}
                    className={`min-h-[420px] p-2 flex flex-col transition-colors ${isToday ? "bg-indigo-50/40" : ""} ${isDragTargetWeek ? "bg-indigo-100/60 ring-2 ring-inset ring-indigo-400" : ""}`}
                    onDragOver={canEdit ? (e) => { e.preventDefault(); setDragOverDate(date); } : undefined}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={canEdit ? () => handleCalendarDrop(date) : undefined}
                  >
                    <div className={`text-center mb-2`}>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase">{DAYS[i]}</p>
                      <span className={`text-sm font-bold w-8 h-8 flex items-center justify-center rounded-full mx-auto ${isToday ? "bg-indigo-600 text-white" : "text-slate-700"}`}>
                        {d.getDate()}
                      </span>
                    </div>
                    {/* Template hint */}
                    {templateConcept && (
                      <div className="mb-2 px-2 py-1 rounded-lg text-[10px] text-slate-500 bg-slate-50 border border-dashed border-slate-200 text-center truncate">
                        💡 {conceptLabel(templateConcept.id, templateConcept.name)}
                      </div>
                    )}
                    <div className="flex-1 space-y-1.5">
                      {pieces.map((piece) => {
                        const isPosted = piece.status === "posted" || !!piece.igMediaId;
                        return (
                          <button
                            key={piece.id}
                            onClick={() => setSelected(piece)}
                            className="w-full text-left rounded-lg px-2 py-2 text-xs hover:opacity-90 transition-opacity"
                            style={isPosted ? {
                              backgroundColor: "#dcfce7",
                              borderLeft: "3px solid #16a34a",
                            } : {
                              backgroundColor: (piece.client?.color || "#6366f1") + "18",
                              borderLeft: `3px solid ${piece.client?.color || "#6366f1"}`,
                            }}
                          >
                            <p className={`font-semibold truncate leading-snug ${isPosted ? "text-green-800" : "text-slate-800"}`}>{piece.title}</p>
                            {piece.concept && <p className={`truncate text-[10px] mt-0.5 ${isPosted ? "text-green-600" : "text-slate-400"}`}>💡 {conceptLabel(piece.conceptId, piece.concept.name)}</p>}
                            <div className="mt-1">
                              {isPosted
                                ? <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-green-700 bg-green-100 rounded px-1.5 py-0.5">✓ Posted</span>
                                : <StatusBadge status={piece.status} />
                              }
                            </div>
                          </button>
                        );
                      })}
                      {draftsOnDay.map((draft) => {
                        const st = draftState(draft);
                        const solid = st.key === "booked" || st.key === "posted";
                        const movable = canEdit && (st.key === "planned" || st.key === "ready");
                        return (
                        <div
                          key={`d-${draft.id}`}
                          draggable={movable}
                          onDragStart={movable ? () => handleDraftDragStart(draft.id) : undefined}
                          onDragEnd={() => { setDragDraftId(null); setDragOverDate(null); }}
                          className={`w-full rounded-lg px-2 py-2 text-xs group/wdraft relative ${movable ? "cursor-grab active:cursor-grabbing" : ""}`}
                          style={solid
                            ? { backgroundColor: st.color, color: "#fff" }
                            : { backgroundColor: st.color + "15", borderLeft: `3px solid ${st.color}` }}
                        >
                          <button onClick={() => (!canEdit || solid) ? setSelectedDraft(draft) : setPendingDrop({ draft, date })} className="w-full text-left" title={st.label}>
                            <p className="font-semibold truncate leading-snug pr-4" style={{ color: solid ? "#fff" : st.color }}>{st.key === "booked" ? "🔒 " : st.key === "posted" ? "✓ " : ""}{draft.title}</p>
                            {draft.concept && <p className={`truncate text-[10px] ${solid ? "text-white/80" : "text-slate-500"}`}>💡 {conceptLabel(draft.conceptId, draft.concept.name)}</p>}
                            {(() => { const t = draft.scheduledDate?.match(/T(\d{2}:\d{2})/)?.[1]; return t ? <p className={`text-[10px] font-semibold ${solid ? "text-white/90" : "text-slate-600"}`}>🕐 {t}</p> : null; })()}
                            {!solid && <p className="text-[10px] mt-0.5" style={{ color: st.color }}>{st.label}</p>}
                            {draft.stage && <p className={`truncate text-[10px] ${solid ? "text-white/70" : "text-slate-400"}`}>📍 {draft.stage.name}</p>}
                          </button>
                          <button
                            onClick={() => unscheduleDraft(draft.id)}
                            className={`absolute top-1 right-1 opacity-0 group-hover/wdraft:opacity-100 transition-all text-sm leading-none ${solid ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-red-500"}`}
                            title="Remove from calendar"
                          >×</button>
                        </div>
                      );})}
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => setShowAdd(true)}
                        className="mt-2 w-full text-[10px] text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 rounded py-1 transition-colors text-center"
                      >
                        + add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

      {/* ── Schedule Board: drag staged drafts onto the calendar ──
          Owner-only, and only when they can edit — view-only members never see it. */}
      {selectedClientId && !isClient && canEdit && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Schedule Board</h2>
              <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                drag onto calendar to schedule
              </span>
            </div>
            <div className="flex items-center gap-3 relative">
              <button
                onClick={() => setBoardColumnPicker((v) => !v)}
                className="text-xs text-slate-500 hover:text-indigo-600 font-medium flex items-center gap-1"
              >
                ⚙ Columns
              </button>
              {boardColumnPicker && (
                <div className="absolute right-16 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3 min-w-[180px]" onClick={(e) => e.stopPropagation()}>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Show columns</p>
                  {(["Ideas", ...stages.map((s) => s.name)]).map((col) => (
                    <label key={col} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-slate-50 rounded px-1">
                      <input
                        type="checkbox"
                        checked={boardColumns.includes(col)}
                        onChange={(e) => {
                          const updated = e.target.checked
                            ? [...boardColumns, col]
                            : boardColumns.filter((c) => c !== col);
                          setBoardColumns(updated);
                          if (selectedClientId) localStorage.setItem(`cf_board_cols_${selectedClientId}`, JSON.stringify(updated));
                        }}
                        className="rounded"
                      />
                      <span className="text-xs text-slate-700">{col}</span>
                    </label>
                  ))}
                </div>
              )}
              <button
                onClick={() => setShowScheduleBoard((v) => !v)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                {showScheduleBoard ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          {showScheduleBoard && (() => {
            const unscheduled = stagedDrafts.filter((d) => !d.scheduledDate);
            if (boardColumns.length === 0) {
              return <p className="px-5 py-8 text-center text-sm text-slate-400">No columns selected — click ⚙ Columns to choose which to show.</p>;
            }
            if (stagedDrafts.length === 0) {
              return <p className="px-5 py-8 text-center text-sm text-slate-400">No scripts yet — generate scripts in the Kanban first.</p>;
            }
            // Group by selected columns (show even if empty)
            const grouped: { label: string; color: string; drafts: ScriptDraft[] }[] = [];
            if (boardColumns.includes("Ideas")) {
              grouped.push({ label: "Ideas", color: "#a855f7", drafts: unscheduled.filter((d) => !d.stageId) });
            }
            stages.filter((st) => boardColumns.includes(st.name)).forEach((st) => {
              grouped.push({ label: st.name, color: st.color, drafts: unscheduled.filter((d) => d.stageId === st.id) });
            });
            return (
              <div className="overflow-x-auto">
                <div className="flex gap-0 min-w-max">
                  {grouped.map((group) => (
                    <div key={group.label} className="w-56 border-r border-slate-100 last:border-r-0 flex-shrink-0">
                      <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
                        <span className="text-xs font-semibold text-slate-700 truncate">{group.label}</span>
                        <span className="ml-auto text-[10px] text-slate-400">{group.drafts.length}</span>
                      </div>
                      <div className="p-2 space-y-1.5 max-h-56 overflow-y-auto">
                        {group.drafts.map((draft) => (
                          <div
                            key={draft.id}
                            draggable={canEdit}
                            onDragStart={canEdit ? () => handleDraftDragStart(draft.id) : undefined}
                            onDragEnd={() => { setDragDraftId(null); setDragOverDate(null); }}
                            onClick={() => setSelectedDraft(draft)}
                            className={`rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 cursor-pointer ${canEdit ? "active:cursor-grabbing hover:border-indigo-300 hover:bg-indigo-50" : ""} transition-colors select-none`}
                          >
                            <p className="text-xs font-semibold text-slate-800 truncate leading-snug">{draft.title}</p>
                            {draft.concept && (
                              <p className="text-[10px] text-indigo-500 truncate mt-0.5">💡 {conceptLabel(draft.conceptId, draft.concept.name)}</p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-0.5">{draft.weekLabel}{(draft.editedVideoUrl ? " · 🎬" : "")}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {showPostIG && selectedClientId && (
        <PostToInstagramModal
          clientId={selectedClientId}
          onClose={() => setShowPostIG(false)}
          onPosted={() => { reload(); setShowPostIG(false); }}
        />
      )}

      {showAdd && (
        <AddContentModal
          clients={clients}
          concepts={concepts}
          stages={stages}
          selectedClientId={selectedClientId}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); reload(); }}
        />
      )}

      {selected && (
        <ContentDetailModal
          piece={selected}
          stages={stages}
          team={team}
          clients={clients}
          onClose={() => setSelected(null)}
          onStatusChange={(status) => updateStatus(selected.id, status)}
          onAdvanceStage={(stageId, memberId, notes, rawUrl) => advanceStage(selected.id, stageId, memberId, notes, rawUrl)}
          onDelete={() => deleteContent(selected.id)}
          onSaved={reload}
        />
      )}
      {selectedDraft && (
        <ScriptDraftModal draft={selectedDraft} onClose={() => setSelectedDraft(null)} />
      )}
      {planDrop && canEdit && (
        <PlanTimeModal
          date={planDrop.date}
          onClose={() => setPlanDrop(null)}
          onPlan={(time) => {
            scheduleDraftOnDate(planDrop.draftId, `${planDrop.date}T${time}`);
            setPlanDrop(null);
          }}
        />
      )}
      {pendingDrop && canEdit && (
        <ConfirmScheduleModal
          draft={pendingDrop.draft}
          date={pendingDrop.date}
          clientId={selectedClientId}
          canPost={!!stages.length && pendingDrop.draft.stageId === stages[stages.length - 1]?.id}
          lastStageName={stages[stages.length - 1]?.name ?? "Schedule"}
          onClose={() => setPendingDrop(null)}
          onConfirm={async (postToIG, opts) => {
            // Keep the chosen time on the draft's scheduledDate so the calendar card
            // shows 🕐 HH:MM (booked cards used to lose the time here).
            await scheduleDraftOnDate(pendingDrop.draft.id, opts.time ? `${pendingDrop.date}T${opts.time}` : pendingDrop.date);
            if (postToIG && selectedClientId) {
              // Post the finished/edited video; fall back to raw only if no edit exists.
              const mediaUrl = pendingDrop.draft.editedVideoUrl || pendingDrop.draft.rawContentUrl || (() => {
                try { const arr = JSON.parse(pendingDrop.draft.rawContentUrls || "[]"); return arr[0] || null; } catch { return null; }
              })();
              const res = await fetch("/api/zernio/schedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  clientId: selectedClientId,
                  content: opts.caption,
                  mediaUrls: mediaUrl ? [mediaUrl] : [],
                  scheduledFor: new Date(`${pendingDrop.date}T${opts.time || "09:00"}:00`).toISOString(),
                  scriptDraftId: pendingDrop.draft.id,
                  trialReel: opts.trialReel,
                }),
              });
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error ?? "Failed to post");
              }
              // Confirmed → mark booked so the calendar shows it locked/solid.
              await fetch(`/api/script-drafts/${pendingDrop.draft.id}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ zernioBooked: true }),
              });
              reload();
            }
            setPendingDrop(null);
          }}
        />
      )}
    </div>
  );
}

// ── Script Draft Modal (read-only view from calendar) ───────────────────────

function ScriptDraftModal({ draft, onClose }: { draft: ScriptDraft; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            {draft.concept && <p className="text-xs font-semibold text-indigo-500 mb-0.5">💡 {draft.concept.conceptType ? `${draft.concept.conceptType} · ${draft.concept.name}` : draft.concept.name}</p>}
            <h2 className="text-base font-bold text-slate-800">{draft.title}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {draft.stage && <span className="text-[10px] bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">📍 {draft.stage.name}</span>}
              <span className="text-[10px] text-slate-400">{draft.weekLabel}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none ml-4">×</button>
        </div>
        {draft.hook && (
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Text Hook</p>
            <p className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{draft.hook}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Script</p>
          <pre className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 whitespace-pre-wrap font-sans leading-relaxed">{draft.script}</pre>
          <p className="text-[10px] text-slate-400 mt-1">{draft.script.split(" ").filter(Boolean).length} words</p>
        </div>
        {draft.caption && (
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Caption</p>
            <pre className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 whitespace-pre-wrap font-sans leading-relaxed">{draft.caption}</pre>
          </div>
        )}
        {draft.editedVideoUrl && (
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Finished Video</p>
            <div className="rounded-xl overflow-hidden bg-slate-900 aspect-video">
              <video src={draft.editedVideoUrl} controls className="w-full h-full object-contain" />
            </div>
          </div>
        )}
        {(() => {
          let raw: string[] = [];
          try { raw = JSON.parse(draft.rawContentUrls || "[]"); } catch { /* ignore */ }
          if (draft.rawContentUrl && !raw.includes(draft.rawContentUrl)) raw = [draft.rawContentUrl, ...raw];
          if (raw.length === 0) return null;
          return (
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Raw Content ({raw.length})</p>
              <div className="space-y-2">
                {raw.map((url, i) => (
                  /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(url)
                    ? <video key={i} src={url} controls className="w-full rounded-lg bg-slate-900 max-h-60 object-contain" />
                    : <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block text-xs text-indigo-600 hover:underline truncate bg-slate-50 rounded-lg px-3 py-2">📎 {url.split("/").pop()}</a>
                ))}
              </div>
            </div>
          );
        })()}
        {draft.scheduledDate && (() => {
          const dt = new Date(draft.scheduledDate.includes("T") ? draft.scheduledDate : draft.scheduledDate + "T00:00:00");
          const hasTime = draft.scheduledDate.includes("T");
          const when = dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + (hasTime ? ` at ${dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "");
          return (
          <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
            <span>📅</span>
            <span>{draft.zernioBooked ? `Scheduled to auto-post · ${when}` : `Planned · ${when} (not yet confirmed)`}</span>
          </div>
          );})()}
      </div>
    </div>
  );
}

// ── Plan-time prompt (asked when a draft is dropped onto a day) ──────────────
function PlanTimeModal({ date, onClose, onPlan }: { date: string; onClose: () => void; onPlan: (time: string) => void }) {
  const [time, setTime] = useState("");
  const pretty = new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-bold text-slate-800">Plan for {pretty}</h2>
          <p className="text-xs text-slate-400 mt-0.5">Pick the time you want this to go out.</p>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Time (local)</label>
          <input type="time" value={time} autoFocus onChange={(e) => setTime(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={() => onPlan(time || "09:00")} disabled={!time}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
            Plan it
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm Schedule Modal ──────────────────────────────────────────────────

interface IGOptions { caption: string; trialReel: boolean; time: string; }

function ConfirmScheduleModal({
  draft, date, clientId, canPost, lastStageName, onClose, onConfirm,
}: {
  draft: ScriptDraft;
  date: string;
  clientId: number | null;
  canPost: boolean;
  lastStageName: string;
  onClose: () => void;
  onConfirm: (postToIG: boolean, opts: IGOptions) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [igStatus, setIgStatus] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [trialReel, setTrialReel] = useState(false);
  const [genCaption, setGenCaption] = useState(false);
  const [scheduleTime, setScheduleTime] = useState(() => {
    const m = (draft.scheduledDate || "").match(/T(\d{2}:\d{2})/);
    return m ? m[1] : "09:00";
  });

  // Prefer the finished/edited video; fall back to raw uploads.
  const videoUrl = draft.editedVideoUrl || draft.rawContentUrl || (() => {
    try { const arr = JSON.parse(draft.rawContentUrls || "[]"); return arr[0] || null; } catch { return null; }
  })();
  const hasMedia = !!videoUrl;
  const isVideo = !!videoUrl && /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(videoUrl);

  async function autoGenerateCaption(silent = false) {
    setGenCaption(true);
    try {
      const d = await fetch("/api/generate-caption", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, hook: draft.hook, script: draft.script, platform: "instagram" }),
      }).then((r) => r.json());
      if (d.caption) setCaption(d.caption);
      else if (d.error && !silent) alert(d.error);
      else if (!d.caption && silent) setCaption(draft.caption || ""); // fall back to the stored caption
    } catch {
      if (silent) setCaption(draft.caption || "");
    } finally {
      setGenCaption(false);
    }
  }

  // Only auto-generate a caption when the item is actually postable (in the
  // Schedule stage) — no point spending tokens on something not ready to book.
  // Otherwise show the draft's stored caption; the ✨ button still works manually.
  useEffect(() => {
    if (canPost) autoGenerateCaption(true);
    else setCaption(draft.caption || "");
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  async function handle(postToIG: boolean) {
    setLoading(true);
    if (postToIG) setIgStatus("Scheduling via Zernio…");
    try {
      await onConfirm(postToIG, { caption, trialReel, time: scheduleTime });
      if (postToIG) setIgStatus(new Date(`${date}T${scheduleTime || "09:00"}:00`).getTime() > Date.now() + 60_000 ? "Scheduled ✓" : "Posted ✓");
    } catch {
      setIgStatus("Failed to post");
    }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-slate-100 flex items-start justify-between">
          <div>
            {draft.concept && <p className="text-xs font-semibold text-indigo-500 mb-0.5">💡 {draft.concept.conceptType ? `${draft.concept.conceptType} · ${draft.concept.name}` : draft.concept.name}</p>}
            <h2 className="text-base font-bold text-slate-800">{draft.title}</h2>
            <p className="text-xs text-slate-400 mt-0.5">Scheduling for <span className="font-semibold text-slate-600">{date}</span></p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none ml-4 mt-0.5">×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Hook (read-only) */}
          {draft.hook && (
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Hook</p>
              <p className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{draft.hook}</p>
            </div>
          )}

          {/* Script (read-only, collapsed) */}
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Script</p>
            <pre className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2 whitespace-pre-wrap font-sans leading-relaxed max-h-32 overflow-y-auto">{draft.script}</pre>
          </div>

          {/* Finished video preview */}
          {videoUrl && (
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Video</p>
              {isVideo ? (
                <div className="rounded-xl overflow-hidden bg-slate-900 aspect-video">
                  <video src={videoUrl} controls className="w-full h-full object-contain" />
                </div>
              ) : (
                <img src={videoUrl} alt="" className="rounded-xl w-full object-cover max-h-64" />
              )}
            </div>
          )}

          {/* Caption — editable, with AI auto-generate */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Caption</p>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400">{caption.length} chars</span>
                <button onClick={() => autoGenerateCaption()} disabled={genCaption}
                  className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
                  {genCaption ? "Generating…" : "✨ Auto-generate caption"}
                </button>
              </div>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              placeholder={genCaption ? "✨ Generating caption…" : "Write your Instagram caption here…"}
              className="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* Trial reel toggle */}
          {hasMedia && (
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={trialReel} onChange={(e) => setTrialReel(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
              <span className="text-xs text-slate-600 leading-relaxed">
                <span className="font-semibold text-slate-700">🧪 Post as trial reel</span> — shown only to non-followers first;
                auto-shares to followers if it performs well.
              </span>
            </label>
          )}

          {/* Posting time */}
          {hasMedia && (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Date</label>
                <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">{date}</div>
              </div>
              <div className="w-32">
                <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Time (local)</label>
                <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            </div>
          )}

          {/* Zernio posting indicator */}
          {hasMedia && canPost && (
            <div className="flex items-start gap-2 bg-indigo-50 rounded-xl px-4 py-3">
              <span className="text-indigo-400 mt-0.5">📡</span>
              <p className="text-[11px] text-indigo-700">Hit <span className="font-semibold">Confirm &amp; Schedule</span> to book this auto-post via Zernio for {scheduleTime} on {date}.</p>
            </div>
          )}

          {igStatus && (
            <p className={`text-sm font-medium text-center ${igStatus.includes("✓") ? "text-green-600" : igStatus.includes("Failed") ? "text-red-500" : "text-indigo-500"}`}>
              {igStatus}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
          <button
            onClick={() => handle(false)}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            Save to Calendar
          </button>
          {(() => {
            const isFuture = new Date(`${date}T${scheduleTime || "09:00"}:00`).getTime() > Date.now() + 60_000;
            return (
            <button
              onClick={() => handle(true)}
              disabled={loading || !hasMedia || !canPost}
              title={!canPost ? `Move this to the "${lastStageName}" stage first` : !hasMedia ? "Upload a video/photo in the Kanban first to enable Instagram posting" : ""}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {loading ? (isFuture ? "Scheduling…" : "Posting…") : (isFuture ? "🗓 Confirm & Schedule" : "📸 Post now")}
            </button>
            );
          })()}
        </div>
        {!canPost && (
          <p className="px-6 pb-4 text-[11px] text-amber-600 text-center">
            🔒 Not ready to schedule — move this to the <span className="font-semibold">{lastStageName}</span> stage in the Kanban (it&apos;s in {draft.stage?.name ? `"${draft.stage.name}"` : "an earlier stage"}) before you can book the auto-post. You can still keep it planned here.
          </p>
        )}
        {canPost && !hasMedia && (
          <p className="px-6 pb-4 text-[11px] text-slate-400 text-center">
            Upload a video or photo in the Kanban stage to enable direct Instagram posting.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Post to Instagram Modal (Buffer-style direct scheduling) ─────────────────

// Cloudinary upload with progress tracking.
// Uses the same preset as the rest of the app; no eager transformations = original quality.
function igUpload(file: File, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME!;
    const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!;
    const resourceType = file.type.startsWith("video") ? "video" : "image";
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", preset);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloud}/${resourceType}/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        // Use fl_attachment to ensure Zernio/Instagram receive raw bytes without transforms
        const url: string = data.secure_url;
        resolve(url);
      } else {
        reject(new Error(JSON.parse(xhr.responseText)?.error?.message ?? "Upload failed"));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
  });
}

function PostToInstagramModal({ clientId, onClose, onPosted }: { clientId: number; onClose: () => void; onPosted: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const today = ymdLocal(new Date());
  const nowTime = new Date().toTimeString().slice(0, 5);

  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaName, setMediaName] = useState<string>("");
  const [caption, setCaption] = useState("");
  const [scheduleDate, setScheduleDate] = useState(today);
  const [scheduleTime, setScheduleTime] = useState(nowTime);
  const [trialReel, setTrialReel] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "posting" | "done" | "error">("idle");
  const [postedNow, setPostedNow] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMediaName(file.name);
    setStatus("uploading");
    setUploadProgress(0);
    setErrorMsg("");
    try {
      const url = await igUpload(file, setUploadProgress);
      setMediaUrl(url);
      setStatus("idle");
    } catch (err) {
      setErrorMsg(String(err));
      setStatus("error");
    } finally {
      setUploadProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handlePost(postNow: boolean) {
    if (!mediaUrl) { setErrorMsg("Upload a video or photo first."); return; }
    setStatus("posting");
    setPostedNow(postNow);
    setErrorMsg("");
    try {
      // postNow = schedule for right now so Zernio publishes immediately (no scheduledFor = draft)
      const scheduledFor = postNow
        ? new Date().toISOString()
        : new Date(`${scheduleDate}T${scheduleTime}:00`).toISOString();
      // Save to DB first so we have a contentPieceId to send to Zernio
      const title = caption.split("\n")[0].trim().slice(0, 80) || `Instagram Post – ${scheduleDate}`;
      const contentRes = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          title,
          caption,
          rawContentUrl: mediaUrl,
          platform: "instagram",
          contentType: "reel",
          status: postNow ? "posted" : "scheduled",
          scheduledDate: `${scheduleDate}T${scheduleTime}:00`,
        }),
      });
      const contentData = await contentRes.json().catch(() => ({}));
      const newPieceId = contentData?.id ?? null;

      const res = await fetch("/api/zernio/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, content: caption, mediaUrls: [mediaUrl], scheduledFor, contentPieceId: newPieceId, trialReel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to post to Instagram");
      }

      onPosted(); // reload calendar
      setStatus("done");
    } catch (err) {
      setErrorMsg(String(err));
      setStatus("error");
    }
  }

  const isLoading = status === "uploading" || status === "posting";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">📸</span>
            <h2 className="text-base font-bold text-slate-800">Post to Instagram</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Media upload */}
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Video / Photo</p>
            <input ref={fileRef} type="file" accept="video/*,image/*" className="hidden" onChange={handleFile} />
            {mediaUrl ? (
              <div className="flex items-center gap-3 bg-green-50 rounded-xl px-4 py-3">
                <span className="text-green-500 text-lg">✓</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-green-700 truncate">{mediaName}</p>
                  <p className="text-[10px] text-green-500 truncate">{mediaUrl}</p>
                </div>
                <button
                  onClick={() => { setMediaUrl(null); setMediaName(""); }}
                  className="text-xs text-slate-400 hover:text-slate-600 shrink-0"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={isLoading}
                className="w-full border-2 border-dashed border-slate-200 rounded-xl py-8 flex flex-col items-center gap-2 text-slate-400 hover:border-indigo-300 hover:text-indigo-400 transition-colors"
              >
                <span className="text-2xl">
                  {status === "uploading" ? `${uploadProgress}%` : "⬆️"}
                </span>
                <p className="text-sm font-medium">
                  {status === "uploading" ? "Uploading…" : "Click to upload video or photo"}
                </p>
                <p className="text-xs">MP4, MOV, JPG, PNG — up to 500 MB</p>
              </button>
            )}
          </div>

          {/* Caption */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Caption</p>
              <span className="text-[10px] text-slate-400">{caption.length} chars</span>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={5}
              placeholder="Write your caption, add hashtags…"
              className="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* Schedule date + time */}
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Schedule</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-slate-500 mb-1">Date</label>
                <input
                  type="date"
                  value={scheduleDate}
                  min={today}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div className="w-32">
                <label className="block text-xs text-slate-500 mb-1">Time (local)</label>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>

            {/* Trial reel toggle */}
            <label className="mt-3 flex items-start gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={trialReel} onChange={(e) => setTrialReel(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
              <span className="text-xs text-slate-600 leading-relaxed">
                <span className="font-semibold text-slate-700">🧪 Post as trial reel</span> — shown only to non-followers first;
                Instagram auto-shares it to your followers if it performs well. (Video reels only.)
              </span>
            </label>
          </div>

          {/* Status */}
          {status === "done" && (
            <div className="flex items-center gap-2 bg-green-50 rounded-xl px-4 py-3">
              <span className="text-green-500">✓</span>
              <p className="text-sm font-medium text-green-700">
                {postedNow ? "Sent to Instagram — should appear shortly!" : `Scheduled for ${scheduleDate} at ${scheduleTime}`}
              </p>
            </div>
          )}
          {(status === "error" || errorMsg) && (
            <p className="text-sm text-red-500 font-medium">{errorMsg}</p>
          )}
        </div>

        {/* Actions */}
        {status !== "done" && (
          <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
            <button
              onClick={() => handlePost(false)}
              disabled={isLoading || !mediaUrl}
              title={!mediaUrl ? "Upload media first" : ""}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {status === "posting" ? "Scheduling…" : "🗓 Schedule"}
            </button>
            <button
              onClick={() => handlePost(true)}
              disabled={isLoading || !mediaUrl}
              title={!mediaUrl ? "Upload media first" : ""}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {status === "posting" ? "Posting…" : "📸 Post Now"}
            </button>
          </div>
        )}
        {status === "done" && (
          <div className="px-6 py-4 border-t border-slate-100">
            <button
              onClick={onClose}
              className="w-full px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Plan Mode Selector ──────────────────────────────────────────────────────

function PlanModeSelector({ current, onChange }: { current: PlanningMode; onChange: (m: PlanningMode) => void }) {
  const [pending, setPending] = useState<PlanningMode>(current);
  const [open, setOpen] = useState(false);

  const MODES = [
    { value: "calendar" as PlanningMode, label: "Calendar", icon: "📅", desc: "Tag individual dates" },
    { value: "template" as PlanningMode, label: "Day Template", icon: "🗓", desc: "Assign recurring day concepts" },
  ];

  const currentMode = MODES.find((m) => m.value === current)!;

  function confirm() {
    onChange(pending);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => { setPending(current); setOpen((o) => !o); }}
        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 transition-colors"
      >
        <span>{currentMode.icon}</span>
        <span>{currentMode.label}</span>
        <span className="text-slate-400 text-xs ml-1">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl z-40 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Planning Mode</p>
          </div>
          <div className="p-2 space-y-1">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setPending(m.value)}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${pending === m.value ? "bg-indigo-50 border border-indigo-200" : "hover:bg-slate-50 border border-transparent"}`}
              >
                <span className="text-lg mt-0.5">{m.icon}</span>
                <div>
                  <p className={`text-sm font-semibold ${pending === m.value ? "text-indigo-700" : "text-slate-700"}`}>{m.label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{m.desc}</p>
                </div>
                {pending === m.value && <span className="ml-auto text-indigo-500 mt-1">✓</span>}
              </button>
            ))}
          </div>
          <div className="px-3 pb-3 flex gap-2">
            <button
              onClick={() => setOpen(false)}
              className="flex-1 py-2 text-sm text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={pending === current}
              className="flex-1 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add Content Modal ───────────────────────────────────────────────────────

function AddContentModal({
  clients, concepts, stages, selectedClientId, onClose, onSaved,
}: {
  clients: Client[];
  concepts: Concept[];
  stages: WorkflowStage[];
  selectedClientId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const activeClient = clients.find((c) => c.id === selectedClientId) ?? null;

  const [form, setForm] = useState({
    clientId: selectedClientId?.toString() || (clients[0]?.id?.toString() ?? ""),
    conceptId: "", title: "", contentType: "video",
    platform: activeClient?.platform || "instagram",
    status: "scripted", scheduledDate: "", hook: "", caption: "", script: "", notes: "",
    currentStageId: stages[0]?.id?.toString() || "",
  });
  const [generatingCaption, setGeneratingCaption] = useState(false);
  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function generateCaption() {
    if (!form.script && !form.hook) return;
    setGeneratingCaption(true);
    try {
      const res = await fetch("/api/generate-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: form.clientId || null, hook: form.hook, script: form.script, platform: form.platform }),
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      set("caption", data.caption || "");
    } catch { alert("Caption generation failed."); }
    finally { setGeneratingCaption(false); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, currentStageId: form.currentStageId || null }),
    });
    onSaved();
  }

  return (
    <Modal title="Add Content" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {activeClient ? (
          <div
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
            style={{ backgroundColor: activeClient.color + "15", border: `1.5px solid ${activeClient.color}30` }}
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: activeClient.color }}>
              {activeClient.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">{activeClient.name}</p>
              <p className="text-xs text-slate-500 capitalize">{activeClient.platform}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
              <input required value={form.title} onChange={(e) => set("title", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Client *</label>
              <select required value={form.clientId} onChange={(e) => set("clientId", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Select client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {activeClient && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
            <input required value={form.title} onChange={(e) => set("title", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
            <select value={form.contentType} onChange={(e) => set("contentType", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Platform</label>
            <select value={form.platform} onChange={(e) => set("platform", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
            <select value={form.status} onChange={(e) => set("status", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Scheduled Date</label>
            <input type="date" value={form.scheduledDate} onChange={(e) => set("scheduledDate", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Concept</label>
            <select value={form.conceptId} onChange={(e) => set("conceptId", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">No concept</option>
              {concepts.map((c) => <option key={c.id} value={c.id}>{(c as any).conceptType ? `${(c as any).conceptType} · ${c.name}` : c.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Text Hook</label>
          <input value={form.hook} onChange={(e) => set("hook", e.target.value)}
            placeholder="The opening hook text..."
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Script</label>
          <textarea rows={5} value={form.script} onChange={(e) => set("script", e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-slate-600">Caption</label>
            <button type="button" onClick={generateCaption} disabled={generatingCaption || (!form.script && !form.hook)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {generatingCaption ? <><span className="animate-spin">⟳</span> Generating…</> : <>✨ Auto Generate</>}
            </button>
          </div>
          <textarea rows={4} value={form.caption} onChange={(e) => set("caption", e.target.value)}
            placeholder="Caption for the post… or click Auto Generate after writing your script."
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700">Save</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Content Detail Modal ────────────────────────────────────────────────────

function ContentDetailModal({
  piece, stages, team, clients, onClose, onStatusChange, onAdvanceStage, onDelete, onSaved,
}: {
  piece: ContentPiece;
  stages: WorkflowStage[];
  team: TeamMember[];
  clients: Client[];
  onClose: () => void;
  onStatusChange: (s: string) => void;
  onAdvanceStage: (stageId: number, memberId?: number, notes?: string, rawUrl?: string) => void;
  onDelete: () => void;
  onSaved: () => void;
}) {
  const [advanceNotes, setAdvanceNotes] = useState("");
  const [rawContentUrl, setRawContentUrl] = useState(piece.rawContentUrl || "");
  const [selectedMember, setSelectedMember] = useState("");
  const [caption, setCaption] = useState(piece.caption || "");
  const [generatingCaption, setGeneratingCaption] = useState(false);
  const [copied, setCopied] = useState(false);
  const [igPosting, setIgPosting] = useState(false);
  const [igPostMsg, setIgPostMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function postToInstagramNow() {
    const videoUrl = rawContentUrl || piece.rawContentUrl;
    if (!videoUrl) { setIgPostMsg({ ok: false, text: "No media uploaded yet — add a video URL first." }); return; }
    setIgPosting(true);
    setIgPostMsg(null);
    try {
      // Post immediately via Zernio — set scheduledFor to now so Zernio publishes right away
      const res = await fetch("/api/zernio/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: piece.clientId,
          content: caption,
          mediaUrls: [videoUrl],
          scheduledFor: new Date().toISOString(),
          contentPieceId: piece.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setIgPostMsg({ ok: false, text: data.error || data.message || "Posting failed" });
      } else {
        // Mark as posted in DB
        await fetch(`/api/content/${piece.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "posted" }),
        });
        onStatusChange("posted");
        setIgPostMsg({ ok: true, text: "✓ Posted to Instagram via Zernio!" });
        onSaved();
      }
    } catch (err) {
      setIgPostMsg({ ok: false, text: String(err) });
    } finally {
      setIgPosting(false);
    }
  }

  async function generateCaption() {
    setGeneratingCaption(true);
    try {
      const res = await fetch("/api/generate-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: piece.clientId, hook: piece.hook, script: piece.script, platform: piece.platform }),
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      const generated = data.caption || "";
      setCaption(generated);
      await fetch(`/api/content/${piece.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...piece, caption: generated }),
      });
      onSaved();
    } catch { alert("Caption generation failed."); }
    finally { setGeneratingCaption(false); }
  }

  async function saveCaption() {
    await fetch(`/api/content/${piece.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...piece, caption }),
    });
    onSaved();
  }

  function copyCaption() {
    navigator.clipboard.writeText(caption);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const currentStage = stages.find((s) => s.id === piece.currentStageId);
  const currentStageIndex = stages.findIndex((s) => s.id === piece.currentStageId);
  const nextStage = stages[currentStageIndex + 1] ?? null;

  return (
    <Modal title={piece.title} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={piece.status} />
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
            {CONTENT_ICONS[piece.contentType]} {piece.contentType}
          </span>
          {piece.client && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: piece.client.color }}>
              {piece.client.name}
            </span>
          )}
          {piece.concept && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
              💡 {(piece.concept as any).conceptType ? `${(piece.concept as any).conceptType} · ${piece.concept.name}` : piece.concept.name}
            </span>
          )}
          {piece.scheduledDate && (() => {
            const dt = new Date(piece.scheduledDate);
            const hasTime = piece.scheduledDate.includes("T");
            const dateStr = dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
            const timeStr = hasTime ? dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null;
            return (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                📅 {dateStr}{timeStr && <><span className="text-slate-300">·</span><span className="font-semibold text-indigo-600">🕐 {timeStr}</span></>}
              </span>
            );
          })()}
        </div>

        {stages.length > 0 && (
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-slate-500 mb-3">WORKFLOW PROGRESS</p>
            <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
              {stages.map((stage, i) => {
                const isDone = currentStageIndex > i || (piece.status === "posted" && !piece.currentStageId);
                const isCurrent = stage.id === piece.currentStageId;
                return (
                  <div key={stage.id} className="flex items-center gap-1.5 flex-shrink-0">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${isDone ? "bg-green-500 border-green-500 text-white" : isCurrent ? "border-2 text-white" : "bg-white border-slate-300 text-slate-400"}`}
                        style={isCurrent ? { backgroundColor: stage.color, borderColor: stage.color } : {}}
                      >
                        {isDone ? "✓" : i + 1}
                      </div>
                      <span className={`text-[10px] mt-1 font-medium max-w-[56px] text-center leading-tight ${isCurrent ? "text-slate-800" : isDone ? "text-green-600" : "text-slate-400"}`}>
                        {stage.name}
                      </span>
                    </div>
                    {i < stages.length - 1 && (
                      <div className={`w-8 h-0.5 flex-shrink-0 ${isDone ? "bg-green-400" : "bg-slate-200"}`} />
                    )}
                  </div>
                );
              })}
            </div>

            {currentStage && (
              <div className="border border-slate-200 rounded-lg p-3 bg-white space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ backgroundColor: currentStage.color }}>
                    {currentStageIndex + 1}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">Currently: {currentStage.name}</span>
                  {currentStage.assignedTo && <span className="text-xs text-slate-500">→ {currentStage.assignedTo.name}</span>}
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Raw Content URL (optional)</label>
                  <input value={rawContentUrl} onChange={(e) => setRawContentUrl(e.target.value)}
                    placeholder="Link to uploaded raw footage / file..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Completed by</label>
                  <select value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="">— Select team member —</option>
                    {team.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role ? ` (${m.role})` : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Notes</label>
                  <input value={advanceNotes} onChange={(e) => setAdvanceNotes(e.target.value)}
                    placeholder="Any notes for next stage..."
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <button
                  onClick={() => onAdvanceStage(currentStage.id, selectedMember ? parseInt(selectedMember) : undefined, advanceNotes, rawContentUrl)}
                  className="w-full py-2 text-xs font-semibold text-white rounded-lg transition-colors"
                  style={{ backgroundColor: currentStage.color }}
                >
                  ✓ Mark "{currentStage.name}" Done{nextStage ? ` → ${nextStage.name}` : " → Complete"}
                </button>
              </div>
            )}
          </div>
        )}

        {piece.rawContentUrl && (() => {
          const url = piece.rawContentUrl;
          const isVideo = /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(url) || url.includes("/video/upload/");
          return (
            <div>
              <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">Media</p>
              {isVideo ? (
                <video
                  src={url}
                  controls
                  className="w-full rounded-xl border border-slate-200 max-h-72 bg-black"
                  preload="metadata"
                />
              ) : (
                <img
                  src={url}
                  alt="Post media"
                  className="w-full rounded-xl border border-slate-200 max-h-72 object-cover"
                />
              )}
            </div>
          );
        })()}

        {piece.hook && (
          <div>
            <p className="text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">Text Hook</p>
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 text-sm font-medium text-indigo-800">{piece.hook}</div>
          </div>
        )}

        {piece.script && (
          <div>
            <p className="text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wide">Script</p>
            <pre className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono whitespace-pre-wrap text-slate-700">{piece.script}</pre>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Caption</p>
            <div className="flex items-center gap-2">
              {caption && (
                <button onClick={copyCaption} className="text-xs px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                  {copied ? "✓ Copied!" : "Copy"}
                </button>
              )}
              <button onClick={generateCaption} disabled={generatingCaption}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {generatingCaption ? <><span className="animate-spin inline-block">⟳</span> Generating…</> : <>✨ {caption ? "Regenerate" : "Auto Generate"}</>}
              </button>
            </div>
          </div>
          <textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={saveCaption}
            placeholder="Caption for the post… click Auto Generate to create one from your script."
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
        </div>

        {/* Post to Instagram directly */}
        {piece.status !== "posted" && (piece.rawContentUrl || rawContentUrl) && (
          <div className="rounded-xl border border-purple-100 bg-purple-50 px-4 py-3 space-y-2">
            <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wide">Instagram</p>
            <button
              onClick={postToInstagramNow}
              disabled={igPosting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {igPosting ? <><span className="animate-spin inline-block">⟳</span> Posting…</> : "📸 Post to Instagram Now"}
            </button>
            {igPostMsg && (
              <p className={`text-xs font-medium text-center ${igPostMsg.ok ? "text-green-600" : "text-red-500"}`}>
                {igPostMsg.text}
              </p>
            )}
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wide">Update Status</p>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button key={s.value} onClick={() => onStatusChange(s.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${piece.status === s.value ? `${s.bg} ${s.text} border-transparent` : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-between pt-2 border-t border-slate-100">
          <button onClick={onDelete} className="text-sm text-red-500 hover:text-red-700">Delete</button>
          <button onClick={onClose} className="px-4 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">Close</button>
        </div>
      </div>
    </Modal>
  );
}
