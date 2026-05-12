"use client";

import { useEffect, useState, useCallback } from "react";
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
};

type CalendarView = "month" | "week";
type PlanningMode = "calendar" | "template";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CONTENT_ICONS: Record<string, string> = {
  video: "🎬", photo: "📷", carousel: "📱", reel: "🎞️", story: "⭕",
};

function getMonthGrid(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const days: (string | null)[] = Array(startOffset).fill(null);
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d).toISOString().slice(0, 10));
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
    return dd.toISOString().slice(0, 10);
  });
}

function parseDayTemplate(raw: string | null | undefined): Record<number, number | null> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export default function Pipeline({ clients, selectedClientId, refreshNotifications, isClient }: Props) {
  const [content, setContent] = useState<ContentPiece[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [stages, setStages] = useState<WorkflowStage[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [scheduledDrafts, setScheduledDrafts] = useState<ScriptDraft[]>([]);
  const [stagedDrafts, setStagedDrafts] = useState<ScriptDraft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<ScriptDraft | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<ContentPiece | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [dragDraftId, setDragDraftId] = useState<number | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [showScheduleBoard, setShowScheduleBoard] = useState(true);
  const [pendingDrop, setPendingDrop] = useState<{ draft: ScriptDraft; date: string } | null>(null);
  const [boardColumnPicker, setBoardColumnPicker] = useState(false);
  const [boardColumns, setBoardColumns] = useState<string[]>(["Ideas"]);

  const [calView, setCalView] = useState<CalendarView>("month");
  const [planMode, setPlanMode] = useState<PlanningMode>("calendar");
  const [offset, setOffset] = useState(0);
  const [openDatePicker, setOpenDatePicker] = useState<string | null>(null);
  const [dateTags, setDateTags] = useState<Record<string, number>>({});

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

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
      body: JSON.stringify({ scheduledDate: null }),
    });
    reload();
  }

  function handleDraftDragStart(draftId: number) {
    setDragDraftId(draftId);
  }

  function handleCalendarDrop(date: string) {
    if (dragDraftId) {
      const draft = stagedDrafts.find((d) => d.id === dragDraftId);
      if (draft) setPendingDrop({ draft, date });
      setDragDraftId(null);
      setDragOverDate(null);
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
          <PlanModeSelector current={planMode} onChange={changePlanMode} />
          {!isClient && (
            <button
              onClick={() => setShowAdd(true)}
              className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              + Add Content
            </button>
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
            const concept = conceptId ? concepts.find((c) => c.id === conceptId) : null;
            return (
              <div key={d} className="border-r border-slate-100 last:border-r-0 px-2 py-2">
                <div className="flex items-center justify-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-400">{d}</span>
                  {planMode === "template" && (
                    concept ? (
                      <button
                        onClick={() => saveDayTemplate({ ...dayTemplate, [i]: null })}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium text-white hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: "#6366f1" }}
                        title="Click to remove"
                      >
                        <span className="truncate max-w-[60px]">{concept.name}</span>
                        <span className="opacity-70">×</span>
                      </button>
                    ) : (
                      <div className="relative group">
                        <button className="w-4 h-4 rounded-full bg-slate-200 hover:bg-indigo-500 text-slate-500 hover:text-white text-[10px] font-bold flex items-center justify-center transition-colors leading-none">
                          +
                        </button>
                        {/* Dropdown on hover */}
                        <div className="absolute top-5 left-0 z-20 hidden group-hover:block bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[160px]">
                          {concepts.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-slate-400">No concepts yet</p>
                          ) : concepts.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => saveDayTemplate({ ...dayTemplate, [i]: c.id })}
                              className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                            >
                              {c.name}
                            </button>
                          ))}
                        </div>
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
                const pieces = date ? content.filter((c) => c.scheduledDate === date) : [];
                const draftsOnDay = date ? scheduledDrafts.filter((d) => d.scheduledDate === date) : [];
                const isToday = date === todayStr;
                const isDragTarget = date !== null && date === dragOverDate && dragDraftId !== null;
                const dow = date ? (new Date(date).getDay() + 6) % 7 : -1; // 0=Mon
                const templateConceptId = dow >= 0 ? dayTemplate[dow] : null;
                const templateConcept = templateConceptId ? concepts.find((c) => c.id === templateConceptId) : null;
                return (
                  <div
                    key={idx}
                    className={`min-h-[100px] border-r border-b border-slate-100 last:border-r-0 p-1.5 transition-colors ${isToday ? "bg-indigo-50/40" : ""} ${!date ? "bg-slate-50/50" : ""} ${isDragTarget ? "bg-indigo-100/60 ring-2 ring-inset ring-indigo-400" : ""}`}
                    onDragOver={date ? (e) => { e.preventDefault(); setDragOverDate(date); } : undefined}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={date ? () => handleCalendarDrop(date) : undefined}
                  >
                    {date && (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-indigo-600 text-white" : "text-slate-500"}`}>
                            {date.slice(8).replace(/^0/, "")}
                          </span>
                          {/* Calendar mode: tag picker per individual date */}
                          {!isClient && planMode === "calendar" && (() => {
                            const tagId = dateTags[date];
                            const tagConcept = tagId ? concepts.find((c) => c.id === tagId) : null;
                            return tagConcept ? (
                              <button
                                onClick={() => setDateTag(date, null)}
                                className="text-[9px] px-1 py-0.5 rounded font-medium text-white hover:opacity-70 truncate max-w-[60px]"
                                style={{ backgroundColor: "#6366f1" }}
                                title="Click to remove tag"
                              >
                                {tagConcept.name}
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
                                        {c.name}
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
                            💡 {templateConcept.name}
                          </div>
                        )}
                        <div className="space-y-1">
                          {pieces.slice(0, 3).map((piece) => (
                            <button
                              key={piece.id}
                              onClick={() => setSelected(piece)}
                              className="w-full text-left rounded-md px-1.5 py-1 text-[10px] font-medium leading-tight hover:opacity-90 transition-opacity truncate"
                              style={{
                                backgroundColor: (piece.client?.color || "#6366f1") + "20",
                                borderLeft: `2px solid ${piece.client?.color || "#6366f1"}`,
                                color: "#1e293b",
                              }}
                            >
                              <div className="truncate">{piece.title}</div>
                            </button>
                          ))}
                          {pieces.length > 3 && (
                            <p className="text-[9px] text-slate-400 pl-1">+{pieces.length - 3} more</p>
                          )}
                          {draftsOnDay.map((draft) => (
                            <div
                              key={`d-${draft.id}`}
                              className="w-full rounded-md px-1.5 py-1 text-[10px] font-medium leading-tight group/draft relative"
                              style={{ backgroundColor: "#6366f115", borderLeft: "2px solid #6366f1", color: "#1e293b" }}
                            >
                              <button onClick={() => setSelectedDraft(draft)} className="w-full text-left">
                                <div className="truncate font-semibold pr-4">{draft.title}</div>
                                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                  {draft.concept && <span className="bg-indigo-100 text-indigo-600 rounded px-1 text-[9px]">💡 {draft.concept.name}</span>}
                                  {draft.stage && <span className="bg-slate-100 text-slate-500 rounded px-1 text-[9px]">📍 {draft.stage.name}</span>}
                                </div>
                              </button>
                              <button
                                onClick={() => unscheduleDraft(draft.id)}
                                className="absolute top-0.5 right-0.5 opacity-0 group-hover/draft:opacity-100 text-slate-400 hover:text-red-500 transition-all leading-none text-[11px] w-4 h-4 flex items-center justify-center"
                                title="Remove from calendar"
                              >×</button>
                            </div>
                          ))}
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
                const pieces = content.filter((c) => c.scheduledDate === date);
                const draftsOnDay = scheduledDrafts.filter((d) => d.scheduledDate === date);
                const isToday = date === todayStr;
                const isDragTargetWeek = date === dragOverDate && dragDraftId !== null;
                const templateConceptId = dayTemplate[i];
                const templateConcept = templateConceptId ? concepts.find((c) => c.id === templateConceptId) : null;
                const d = new Date(date);
                return (
                  <div
                    key={date}
                    className={`min-h-[420px] p-2 flex flex-col transition-colors ${isToday ? "bg-indigo-50/40" : ""} ${isDragTargetWeek ? "bg-indigo-100/60 ring-2 ring-inset ring-indigo-400" : ""}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOverDate(date); }}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={() => handleCalendarDrop(date)}
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
                        💡 {templateConcept.name}
                      </div>
                    )}
                    <div className="flex-1 space-y-1.5">
                      {pieces.map((piece) => (
                        <button
                          key={piece.id}
                          onClick={() => setSelected(piece)}
                          className="w-full text-left rounded-lg px-2 py-2 text-xs hover:opacity-90 transition-opacity"
                          style={{
                            backgroundColor: (piece.client?.color || "#6366f1") + "18",
                            borderLeft: `3px solid ${piece.client?.color || "#6366f1"}`,
                          }}
                        >
                          <p className="font-semibold text-slate-800 truncate leading-snug">{piece.title}</p>
                          {piece.concept && <p className="text-slate-400 truncate text-[10px] mt-0.5">💡 {piece.concept.name}</p>}
                          <div className="mt-1"><StatusBadge status={piece.status} /></div>
                        </button>
                      ))}
                      {draftsOnDay.map((draft) => (
                        <div
                          key={`d-${draft.id}`}
                          className="w-full rounded-lg px-2 py-2 text-xs group/wdraft relative"
                          style={{ backgroundColor: "#6366f115", borderLeft: "3px solid #6366f1" }}
                        >
                          <button onClick={() => setSelectedDraft(draft)} className="w-full text-left">
                            <p className="font-semibold text-slate-800 truncate leading-snug pr-4">{draft.title}</p>
                            {draft.concept && <p className="text-indigo-500 truncate text-[10px] mt-0.5">💡 {draft.concept.name}</p>}
                            {draft.stage && <p className="text-slate-400 truncate text-[10px]">📍 {draft.stage.name}</p>}
                          </button>
                          <button
                            onClick={() => unscheduleDraft(draft.id)}
                            className="absolute top-1 right-1 opacity-0 group-hover/wdraft:opacity-100 text-slate-400 hover:text-red-500 transition-all text-sm leading-none"
                            title="Remove from calendar"
                          >×</button>
                        </div>
                      ))}
                    </div>
                    {!isClient && (
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

      {/* ── Schedule Board: drag staged drafts onto the calendar ── */}
      {selectedClientId && (
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
                            draggable
                            onDragStart={() => handleDraftDragStart(draft.id)}
                            onDragEnd={() => { setDragDraftId(null); setDragOverDate(null); }}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 cursor-grab active:cursor-grabbing hover:border-indigo-300 hover:bg-indigo-50 transition-colors select-none"
                          >
                            <p className="text-xs font-semibold text-slate-800 truncate leading-snug">{draft.title}</p>
                            {draft.concept && (
                              <p className="text-[10px] text-indigo-500 truncate mt-0.5">💡 {draft.concept.name}</p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-0.5">{draft.weekLabel}</p>
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
      {pendingDrop && (
        <ConfirmScheduleModal
          draft={pendingDrop.draft}
          date={pendingDrop.date}
          onClose={() => setPendingDrop(null)}
          onConfirm={async (postToIG, opts) => {
            await scheduleDraftOnDate(pendingDrop.draft.id, pendingDrop.date);
            if (postToIG && selectedClientId) {
              await fetch("/api/instagram/publish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  clientId: selectedClientId,
                  draftId: pendingDrop.draft.id,
                  caption: opts.caption,
                  videoUrl: pendingDrop.draft.rawContentUrl || null,
                  autoSubtitles: opts.autoSubtitles,
                  shareToFeed: opts.shareToFeed,
                }),
              });
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
            {draft.concept && <p className="text-xs font-semibold text-indigo-500 mb-0.5">💡 {draft.concept.name}</p>}
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
      </div>
    </div>
  );
}

// ── Confirm Schedule Modal ──────────────────────────────────────────────────

interface IGOptions { caption: string; autoSubtitles: boolean; shareToFeed: boolean; }

function ConfirmScheduleModal({
  draft, date, onClose, onConfirm,
}: {
  draft: ScriptDraft;
  date: string;
  onClose: () => void;
  onConfirm: (postToIG: boolean, opts: IGOptions) => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [igStatus, setIgStatus] = useState<string | null>(null);
  const [caption, setCaption] = useState(draft.caption || "");
  const [autoSubtitles, setAutoSubtitles] = useState(false);
  const [shareToFeed, setShareToFeed] = useState(true);

  const hasMedia = !!(draft.rawContentUrl || (draft.rawContentUrls && draft.rawContentUrls !== "[]"));
  const isVideo = (() => {
    const url = draft.rawContentUrl || (() => {
      try { const arr = JSON.parse(draft.rawContentUrls || "[]"); return arr[0] || null; } catch { return null; }
    })();
    return url ? /\.(mp4|mov|avi|mkv)(\?|$)/i.test(url) : false;
  })();

  const videoUrl = draft.rawContentUrl || (() => {
    try { const arr = JSON.parse(draft.rawContentUrls || "[]"); return arr[0] || null; } catch { return null; }
  })();

  async function handle(postToIG: boolean) {
    setLoading(true);
    if (postToIG) setIgStatus("Uploading to Instagram…");
    try {
      await onConfirm(postToIG, { caption, autoSubtitles, shareToFeed });
      if (postToIG) setIgStatus("Posted ✓");
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
            {draft.concept && <p className="text-xs font-semibold text-indigo-500 mb-0.5">💡 {draft.concept.name}</p>}
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

          {/* Caption — editable */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Caption</p>
              <span className="text-[10px] text-slate-400">{caption.length} chars</span>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              placeholder="Write your Instagram caption here…"
              className="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* Video file indicator */}
          {videoUrl && (
            <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
              <span>🎬</span>
              <span className="truncate flex-1">{videoUrl}</span>
            </div>
          )}

          {/* Instagram posting options */}
          {hasMedia && (
            <div className="border border-slate-100 rounded-xl p-4 space-y-3">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Instagram Options</p>

              {/* Share to feed (Reels only) */}
              {isVideo && (
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <p className="text-sm font-medium text-slate-700">Share to feed</p>
                    <p className="text-[11px] text-slate-400">Also show this reel on your profile grid</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShareToFeed((v) => !v)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${shareToFeed ? "bg-indigo-600" : "bg-slate-200"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${shareToFeed ? "translate-x-4" : "translate-x-1"}`} />
                  </button>
                </label>
              )}

              {/* Auto-captions (Reels only) */}
              {isVideo && (
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <p className="text-sm font-medium text-slate-700">Auto-captions</p>
                    <p className="text-[11px] text-slate-400">Instagram generates subtitles automatically</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAutoSubtitles((v) => !v)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${autoSubtitles ? "bg-indigo-600" : "bg-slate-200"}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${autoSubtitles ? "translate-x-4" : "translate-x-1"}`} />
                  </button>
                </label>
              )}

              {/* Music note */}
              <div className="flex items-start gap-2 bg-amber-50 rounded-lg px-3 py-2">
                <span className="text-amber-400 mt-0.5">🎵</span>
                <p className="text-[11px] text-amber-700">Music must be added manually in the Instagram app after posting — the API doesn't allow song selection.</p>
              </div>

              {/* Trial reel note */}
              <div className="flex items-start gap-2 bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-slate-400 mt-0.5">🧪</span>
                <p className="text-[11px] text-slate-500">Trial reels are only available inside the Instagram app — not via the API.</p>
              </div>
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
          <button
            onClick={() => handle(true)}
            disabled={loading || !hasMedia}
            title={!hasMedia ? "Upload a video/photo in the Kanban first to enable Instagram posting" : ""}
            className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {loading ? "Posting…" : "📸 Post to Instagram"}
          </button>
        </div>
        {!hasMedia && (
          <p className="px-6 pb-4 text-[11px] text-slate-400 text-center">
            Upload a video or photo in the Kanban stage to enable direct Instagram posting.
          </p>
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
              {concepts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
              💡 {piece.concept.name}
            </span>
          )}
          {piece.scheduledDate && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
              📅 {piece.scheduledDate}
            </span>
          )}
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
