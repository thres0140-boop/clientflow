"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Client, ContentPiece, Concept, WorkflowStage, TeamMember,
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
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<ContentPiece | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");

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
    const [c, co, s, t] = await Promise.all([
      fetch(`/api/content${qs}`).then((r) => r.json()),
      fetch(`/api/concepts${selectedClientId ? `?clientId=${selectedClientId}` : ""}`).then((r) => r.json()),
      fetch("/api/workflow").then((r) => r.json()),
      fetch("/api/team").then((r) => r.json()),
    ]);
    setContent(c);
    setConcepts(co);
    setStages(s);
    setTeam(t);
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
                const isToday = date === todayStr;
                const dow = date ? (new Date(date).getDay() + 6) % 7 : -1; // 0=Mon
                const templateConceptId = dow >= 0 ? dayTemplate[dow] : null;
                const templateConcept = templateConceptId ? concepts.find((c) => c.id === templateConceptId) : null;
                return (
                  <div
                    key={idx}
                    className={`min-h-[100px] border-r border-b border-slate-100 last:border-r-0 p-1.5 ${isToday ? "bg-indigo-50/40" : ""} ${!date ? "bg-slate-50/50" : ""}`}
                  >
                    {date && (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-indigo-600 text-white" : "text-slate-500"}`}>
                            {date.slice(8).replace(/^0/, "")}
                          </span>
                          {/* Calendar mode: tag picker per individual date */}
                          {planMode === "calendar" && (() => {
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
                const isToday = date === todayStr;
                const templateConceptId = dayTemplate[i];
                const templateConcept = templateConceptId ? concepts.find((c) => c.id === templateConceptId) : null;
                const d = new Date(date);
                return (
                  <div key={date} className={`min-h-[420px] p-2 flex flex-col ${isToday ? "bg-indigo-50/40" : ""}`}>
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
                    </div>
                    <button
                      onClick={() => setShowAdd(true)}
                      className="mt-2 w-full text-[10px] text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 rounded py-1 transition-colors text-center"
                    >
                      + add
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      {/* Filter + Content list */}
      <div className="bg-white rounded-2xl border border-slate-200">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">All Content ({filteredContent.length})</h2>
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setFilterStatus("all")}
              className={`px-3 py-1 rounded-lg text-xs font-medium ${filterStatus === "all" ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"}`}
            >
              All
            </button>
            {STATUSES.map((s) => (
              <button
                key={s.value}
                onClick={() => setFilterStatus(s.value)}
                className={`px-3 py-1 rounded-lg text-xs font-medium ${filterStatus === s.value ? `${s.bg} ${s.text}` : "text-slate-500 hover:bg-slate-100"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {filteredContent.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-slate-400 text-sm mb-3">{isClient ? "No content yet." : "No content yet. Add your first piece!"}</p>
            {!isClient && <button onClick={() => setShowAdd(true)} className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700">+ Add Content</button>}
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {filteredContent.map((piece) => (
              <button
                key={piece.id}
                onClick={() => setSelected(piece)}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 text-left group"
              >
                <span className="text-base">{CONTENT_ICONS[piece.contentType] || "🎬"}</span>
                {piece.client && <ClientAvatar name={piece.client.name} color={piece.client.color} size="sm" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{piece.title}</p>
                  <p className="text-xs text-slate-400">
                    {piece.client?.name} · {piece.contentType}
                    {piece.concept ? ` · ${piece.concept.name}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {piece.scheduledDate && (
                    <span className="text-xs text-slate-400 bg-slate-100 px-2 py-1 rounded-md">{piece.scheduledDate}</span>
                  )}
                  <StatusBadge status={piece.status} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

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
