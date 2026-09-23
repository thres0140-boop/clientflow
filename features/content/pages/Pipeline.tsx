"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Client, ContentPiece, Concept, WorkflowStage, TeamMember, ScriptDraft,
  STATUSES, CONTENT_TYPES,
} from "@/shared/types";
import StatusBadge from "@/shared/ui/StatusBadge";
import ClientAvatar from "@/shared/ui/ClientAvatar";
import Modal from "@/shared/ui/Modal";
import { videoSrc } from "@/shared/media/videoSrc";
import { isPlatformId, type PlatformId } from "@/shared/platforms";
import { parseDayTemplate, serializeDayTemplate, type DayMap, type DayTemplate } from "@/shared/dayTemplate";
import { QRCodeSVG } from "qrcode.react";

type Props = {
  clients: Client[];
  // Every platform the selected client has enabled — the calendar merges all of them.
  enabledPlatforms: PlatformId[];
  selectedClientId: number | null;
  refreshClients: () => void;
  refreshNotifications: () => void;
  isClient?: boolean;
  readOnly?: boolean; // view-only: can see the page but not add/schedule/edit
  onOpenInKanban?: (draftId: number) => void; // clients: jump to the board instead of opening edit modals
};

type CalendarView = "month" | "week";
type PlanningMode = "calendar" | "template";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CONTENT_ICONS: Record<string, string> = {
  video: "🎬", photo: "📷", carousel: "📱", reel: "🎞️", story: "⭕",
};
const PLATFORM_BADGE: Record<PlatformId, string> = { instagram: "📸", tiktok: "🎵" };
const PLATFORM_LABEL: Record<PlatformId, string> = { instagram: "Instagram", tiktok: "TikTok" };

// Platform of a draft / content piece / stage / concept. A NULL or unknown platform is treated
// as Instagram — the client's primary/legacy platform (mirrors /api/content's null handling).
function platformOf(x: { platform?: string | null } | null | undefined): PlatformId {
  const p = x?.platform;
  return isPlatformId(p) ? p : "instagram";
}

// Schedule Board column keys are platform-qualified ("instagram:Edit") so two platforms that
// both have an "Edit" stage never share a column. Legacy saved keys were bare stage names.
function colKey(p: PlatformId, name: string): string { return `${p}:${name}`; }
function splitColKey(key: string): { platform: PlatformId; name: string } | null {
  const i = key.indexOf(":");
  if (i === -1) return null;
  const p = key.slice(0, i);
  return isPlatformId(p) ? { platform: p, name: key.slice(i + 1) } : null;
}

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

export default function Pipeline({ clients, enabledPlatforms, selectedClientId, refreshNotifications, isClient, readOnly = false, onOpenInKanban }: Props) {
  // The platforms this calendar merges. Never empty: the shell always includes "instagram"
  // unless the client explicitly switched it off.
  const platforms: PlatformId[] = enabledPlatforms.length ? enabledPlatforms : ["instagram"];
  const platformsParam = platforms.join(","); // for the `platforms=` query param (shared/platforms.ts)
  // Badges only matter when more than one platform shares the calendar; a single-platform
  // client sees exactly what it saw before.
  const multi = platforms.length > 1;
  const badge = (p: PlatformId) => (multi ? `${PLATFORM_BADGE[p]} ` : "");
  // Clients shouldn't open the editing modals from the calendar (it confuses them into
  // thinking they work from here). A click just takes them to the board, highlighted.
  const openDraft = (draft: ScriptDraft) => {
    if (isClient && onOpenInKanban) { onOpenInKanban(draft.id); return; }
    setSelectedDraft(draft);
  };
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
  function draftState(d: ScriptDraft): { key: "planned" | "edited" | "ready" | "booked" | "posted"; color: string; label: string } {
    // Stage lookups always run against the draft's OWN platform's stage list — `stages` holds
    // every enabled platform's stages, so "last" and "edit" must never be read off the merged array.
    const ps = stagesFor(platformOf(d));
    const lastStageId = ps.length ? ps[ps.length - 1].id : null;
    if (d.status === "posted") return { key: "posted", color: "#16a34a", label: "Posted" };
    if (d.zernioBooked) return { key: "booked", color: "#2563eb", label: "Scheduled" };
    if (lastStageId != null && d.stageId === lastStageId) return { key: "ready", color: "#f97316", label: "Ready · tap to confirm" };
    // Has a finished cut AND is past the Edit stage → "edited, not confirmed" (yellow).
    // If it was moved back to Edit (or earlier), it's being re-worked, so don't call it
    // edited even though an old cut is still attached.
    if (d.editedVideoUrl) {
      const editStage = ps.find((s) => s.name.toLowerCase() === "edit");
      const dStage = ps.find((s) => s.id === d.stageId);
      const pastEdit = !editStage || !dStage || dStage.order > editStage.order;
      if (pastEdit) return { key: "edited", color: "#eab308", label: "Edited · not confirmed" };
    }
    return { key: "planned", color: "#ef4444", label: "Planned · not in Schedule yet" };
  }
  // `stages` is the merged list for every enabled platform (ordered by `order`, so platforms
  // interleave). Every ordered lookup goes through stagesFor(platform).
  const [stages, setStages] = useState<WorkflowStage[]>([]);
  const stagesFor = (p: PlatformId): WorkflowStage[] => stages.filter((s) => platformOf(s) === p);
  const conceptsFor = (p: PlatformId): Concept[] => concepts.filter((c) => platformOf(c) === p);
  // Every Schedule Board column this client can show, in display order.
  const allColumnKeys: string[] = platforms.flatMap((p) => [colKey(p, "Ideas"), ...stagesFor(p).map((s) => colKey(p, s.name))]);
  const columnLabel = (key: string): string => { const s = splitColKey(key); return s ? `${badge(s.platform)}${s.name}` : key; };
  // Saved column keys may be legacy bare names ("Edit"); a bare name means that column on EVERY
  // enabled platform, so nothing a user chose before disappears or gets absorbed elsewhere.
  // A platform with no saved keys at all (just enabled) starts with all of its columns shown.
  const normalizeColumns = (saved: string[]): string[] => {
    const keys = saved.flatMap((k) => (splitColKey(k) ? [k] : platforms.map((p) => colKey(p, k))));
    for (const p of platforms) {
      if (!keys.some((k) => splitColKey(k)?.platform === p)) keys.push(...allColumnKeys.filter((k) => splitColKey(k)?.platform === p));
    }
    return keys;
  };
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [scheduledDrafts, setScheduledDrafts] = useState<ScriptDraft[]>([]);
  const [stagedDrafts, setStagedDrafts] = useState<ScriptDraft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<ScriptDraft | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showPost, setShowPost] = useState<PlatformId | null>(null); // direct-post modal, per platform
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
  const [openTemplateDay, setOpenTemplateDay] = useState<string | null>(null); // "<platform>:<weekday>"
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
  const [dayTemplate, setDayTemplate] = useState<DayTemplate>({}); // per platform: weekday → conceptId

  const reload = useCallback(async () => {
    const [c, co, s, t, allDrafts] = await Promise.all([
      fetch(`/api/content?platforms=${platformsParam}${selectedClientId ? `&clientId=${selectedClientId}` : ""}`).then((r) => r.json()),
      fetch(`/api/concepts?platforms=${platformsParam}${selectedClientId ? `&clientId=${selectedClientId}` : ""}`).then((r) => r.json()),
      fetch(`/api/workflow?platforms=${platformsParam}${selectedClientId ? `&clientId=${selectedClientId}` : ""}`).then((r) => r.json()),
      fetch(selectedClientId ? `/api/team?clientId=${selectedClientId}` : "/api/team").then((r) => r.json()),
      selectedClientId ? fetch(`/api/script-drafts?clientId=${selectedClientId}&all=true&platforms=${platformsParam}`).then((r) => r.json()) : Promise.resolve([]),
    ]);
    // Guard against non-array responses (e.g. a transient 403 returns {error}) so a
    // failed fetch never white-screens the page.
    setContent(Array.isArray(c) ? c : []);
    setConcepts(Array.isArray(co) ? co.filter((c: Concept) => !c.isIdea) : []);
    setStages(Array.isArray(s) ? s : []);
    setTeam(Array.isArray(t) ? t : []);
    const allStaged: ScriptDraft[] = Array.isArray(allDrafts) ? allDrafts : [];
    setStagedDrafts(allStaged);
    setScheduledDrafts(allStaged.filter((d: ScriptDraft) => d.scheduledDate));
  }, [selectedClientId, platformsParam]);

  useEffect(() => { reload(); }, [reload]);

  // Restore per-client settings from localStorage when client changes
  useEffect(() => {
    if (!selectedClientId) return;
    const savedMode = localStorage.getItem(`cf_plan_mode_${selectedClientId}`) as PlanningMode | null;
    if (savedMode === "calendar" || savedMode === "template") setPlanMode(savedMode);
    else setPlanMode("calendar");
    const savedTags = localStorage.getItem(`cf_date_tags_${selectedClientId}`);
    setDateTags(savedTags ? JSON.parse(savedTags) : {});
    // boardColumns default is handled in its own effect (needs stages loaded first).
  }, [selectedClientId]);

  // Schedule Board columns: restore the saved choice, else default to showing ALL
  // columns (Ideas + every stage). Runs once stages are loaded for the client.
  useEffect(() => {
    if (!selectedClientId) return;
    const saved = localStorage.getItem(`cf_board_cols_${selectedClientId}`);
    if (saved) { try { setBoardColumns(normalizeColumns(JSON.parse(saved))); return; } catch { /* fall through */ } }
    if (stages.length) setBoardColumns(allColumnKeys);
  }, [selectedClientId, stages, platformsParam]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Save one platform's weekday map; the other platforms' maps are kept untouched.
  async function saveDayTemplate(platform: PlatformId, map: DayMap) {
    if (!activeClient) return;
    const updated: DayTemplate = { ...dayTemplate, [platform]: map };
    setDayTemplate(updated);
    await fetch(`/api/clients/${activeClient.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...activeClient, dayTemplate: serializeDayTemplate(updated) }),
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
    // Cancel on Zernio (recovering the post id if we don't have it stored) AND clear the
    // local booking. Returns needsManual=true if Zernio's post couldn't be found.
    const r = await fetch("/api/zernio/cancel", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId }),
    }).then((res) => res.json()).catch(() => ({}));
    // Also clear the planned date so the card leaves the calendar slot.
    await fetch(`/api/script-drafts/${draftId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledDate: null }),
    }).catch(() => {});
    if (r?.needsManual) {
      alert("Cleared it here, but I couldn't find this post on Zernio to cancel it automatically — please delete it in Zernio too, just in case.");
    }
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
          <h1 className="text-2xl font-bold text-ink">Content Pipeline</h1>
          <p className="text-muted text-sm mt-0.5">
            {activeClient ? activeClient.name : "All clients"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && <PlanModeSelector current={planMode} onChange={changePlanMode} />}
          {canEdit && (
            <>
              {platforms.map((p) => (
                <button
                  key={p}
                  onClick={() => setShowPost(p)}
                  className="bg-gradient-to-r from-accent to-pink-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity flex items-center gap-1.5"
                >
                  <span>{PLATFORM_BADGE[p]}</span> Post to {PLATFORM_LABEL[p]}
                </button>
              ))}
              <button
                onClick={() => setShowAdd(true)}
                className="bg-accent text-on-accent px-4 py-2 rounded-xl text-sm font-semibold hover:bg-accent-strong transition-colors"
              >
                + Add Content
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── CALENDAR (both modes share the same view) ────────── */}
      <div className="bg-surface rounded-2xl border border-line overflow-hidden">
        {/* Calendar toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-ink">{calendarHeader()}</h2>
            <div className="flex items-center bg-surface-3 rounded-md p-0.5 text-xs">
              <button
                onClick={() => { setCalView("month"); setOffset(0); }}
                className={`px-2.5 py-1 rounded transition-all ${calView === "month" ? "bg-surface text-ink-2 shadow-sm font-medium" : "text-faint"}`}
              >
                Month
              </button>
              <button
                onClick={() => { setCalView("week"); setOffset(0); }}
                className={`px-2.5 py-1 rounded transition-all ${calView === "week" ? "bg-surface text-ink-2 shadow-sm font-medium" : "text-faint"}`}
              >
                Week
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={calendarPrev} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-3 text-muted">‹</button>
            <button onClick={calendarToday} className="px-2.5 h-7 text-xs font-medium text-muted hover:bg-surface-3 rounded-lg">Today</button>
            <button onClick={calendarNext} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-3 text-muted">›</button>
          </div>
        </div>

        {/* Day headers — in template mode each header gets one concept picker PER enabled platform
            (each lane only offers that platform's concepts). */}
        <div className="grid grid-cols-7 border-b border-line bg-surface-2">
          {DAYS.map((d, i) => (
            <div key={d} className="border-r border-line last:border-r-0 px-2 py-2">
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-faint">{d}</span>
                {planMode === "template" && canEdit && platforms.map((p) => {
                  const map = dayTemplate[p] ?? {};
                  const conceptId = map[i] ?? null;
                  const pickerKey = `${p}:${i}`;
                  const laneConcepts = conceptsFor(p);
                  return conceptId ? (
                    <button
                      key={p}
                      onClick={() => saveDayTemplate(p, { ...map, [i]: null })}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium text-white hover:opacity-80 transition-opacity"
                      style={{ backgroundColor: "var(--color-accent-legacy)" }}
                      title={`${multi ? `${PLATFORM_LABEL[p]} · ` : ""}Click to remove`}
                    >
                      <span className="truncate max-w-[90px]">{badge(p)}{conceptLabel(conceptId)}</span>
                      <span className="opacity-70">×</span>
                    </button>
                  ) : (
                    <div key={p} className="relative">
                      <button onClick={() => setOpenTemplateDay(openTemplateDay === pickerKey ? null : pickerKey)}
                        title={multi ? `Set ${PLATFORM_LABEL[p]} concept` : undefined}
                        className={`${multi ? "px-1 min-w-4" : "w-4"} h-4 rounded-full bg-surface-4 hover:bg-accent text-muted hover:text-on-accent text-[10px] font-bold flex items-center justify-center transition-colors leading-none`}>
                        {multi ? `${PLATFORM_BADGE[p]}+` : "+"}
                      </button>
                      {openTemplateDay === pickerKey && (
                        <>
                          {/* click-away backdrop */}
                          <div className="fixed inset-0 z-10" onClick={() => setOpenTemplateDay(null)} />
                          <div className="absolute top-5 left-0 z-20 bg-surface border border-line rounded-xl o-elev-lift py-1 min-w-[160px] max-h-64 overflow-y-auto">
                            {multi && <p className="px-3 py-1 text-[10px] font-semibold text-faint uppercase tracking-wide">{PLATFORM_BADGE[p]} {PLATFORM_LABEL[p]}</p>}
                            {laneConcepts.length === 0 ? (
                              <p className="px-3 py-2 text-xs text-faint">No {multi ? `${PLATFORM_LABEL[p]} ` : ""}concepts yet</p>
                            ) : laneConcepts.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => { saveDayTemplate(p, { ...map, [i]: c.id }); setOpenTemplateDay(null); }}
                                className="w-full text-left px-3 py-1.5 text-xs text-ink-2 hover:bg-accent-tint hover:text-accent-strong"
                              >
                                {conceptLabel(c.id, c.name)}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {calView === "month" ? (
            <div className="grid grid-cols-7">
              {monthGrid.map((date, idx) => {
                const pieces = date ? content.filter((c) => c.scheduledDate?.startsWith(date)) : [];
                const draftsOnDay = date ? scheduledDrafts.filter((d) => d.scheduledDate?.startsWith(date)) : [];
                const isToday = date === todayStr;
                const isDragTarget = date !== null && date === dragOverDate && dragDraftId !== null;
                const dow = date ? (new Date(date + "T00:00:00").getDay() + 6) % 7 : -1; // 0=Mon (parse local, not UTC)
                const templateHints = dow >= 0 ? templateHintsFor(dow) : [];
                return (
                  <div
                    key={idx}
                    className={`min-h-[100px] border-r border-b border-line last:border-r-0 p-1.5 transition-colors ${isToday ? "bg-accent-tint/40" : ""} ${!date ? "bg-surface-2/50" : ""} ${isDragTarget ? "bg-accent-tint/60 ring-2 ring-inset ring-accent" : ""}`}
                    onDragOver={date && canEdit ? (e) => { e.preventDefault(); setDragOverDate(date); } : undefined}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={date && canEdit ? () => handleCalendarDrop(date) : undefined}
                  >
                    {date && (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-accent text-on-accent" : "text-muted"}`}>
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
                                style={{ backgroundColor: "var(--color-accent-legacy)" }}
                                title="Click to remove tag"
                              >
                                {conceptLabel(tagConcept.id, tagConcept.name)}
                              </button>
                            ) : (
                              <div className="relative">
                                <button
                                  onClick={() => setOpenDatePicker(openDatePicker === date ? null : date)}
                                  className="w-4 h-4 rounded-full bg-surface-3 hover:bg-accent-tint text-faint hover:text-accent text-[10px] font-bold flex items-center justify-center transition-colors"
                                >
                                  +
                                </button>
                                {openDatePicker === date && (
                                  <div className="absolute top-5 right-0 z-30 bg-surface border border-line rounded-xl o-elev-lift py-1 min-w-[150px]">
                                    {concepts.length === 0 ? (
                                      <p className="px-3 py-2 text-xs text-faint">No concepts yet</p>
                                    ) : concepts.map((c) => (
                                      <button
                                        key={c.id}
                                        onClick={() => setDateTag(date, c.id)}
                                        className="w-full text-left px-3 py-1.5 text-xs text-ink-2 hover:bg-accent-tint hover:text-accent-strong"
                                      >
                                        {badge(platformOf(c))}{conceptLabel(c.id, c.name)}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                        {/* Template hint (faint, only in template mode) — one per platform with a concept that day */}
                        {planMode === "template" && pieces.length === 0 && templateHints.map((h) => (
                          <div key={h.platform} className="mb-1 px-1.5 py-0.5 rounded text-[9px] text-faint border border-dashed border-line truncate">
                            💡 {badge(h.platform)}{conceptLabel(h.concept.id, h.concept.name)}
                          </div>
                        ))}
                        <div className="space-y-1">
                          {pieces.slice(0, 3).map((piece) => {
                            const isPosted = piece.status === "posted" || !!piece.igMediaId;
                            return (
                              <button
                                key={piece.id}
                                onClick={(isClient && onOpenInKanban) ? undefined : () => setSelected(piece)}
                                className="w-full text-left rounded-md px-1.5 py-1 text-[10px] font-medium leading-tight hover:opacity-90 transition-opacity truncate"
                                style={isPosted ? {
                                  backgroundColor: "var(--color-chip-posted-bg)",
                                  borderLeft: "2px solid #16a34a",
                                  color: "var(--color-chip-posted-ink)",
                                } : {
                                  backgroundColor: (piece.client?.color || "#6366f1") + "20",
                                  borderLeft: `2px solid ${piece.client?.color || "#6366f1"}`,
                                  color: "var(--color-chip-ink)",
                                }}
                              >
                                <div className="truncate">{badge(platformOf(piece))}{piece.title}</div>
                                {isPosted && <div className="text-[8px] font-semibold text-ok-600 mt-0.5">✓ Posted</div>}
                              </button>
                            );
                          })}
                          {pieces.length > 3 && (
                            <p className="text-[9px] text-faint pl-1">+{pieces.length - 3} more</p>
                          )}
                          {draftsOnDay.map((draft) => {
                            const st = draftState(draft);
                            const solid = st.key === "booked" || st.key === "posted";
                            // Only planning-stage cards can be dragged between days; booked/posted
                            // are locked (moving them would desync the live Zernio booking).
                            const movable = canEdit && (st.key === "planned" || st.key === "edited" || st.key === "ready");
                            return (
                            <div
                              key={`d-${draft.id}`}
                              draggable={movable}
                              onDragStart={movable ? () => handleDraftDragStart(draft.id) : undefined}
                              onDragEnd={() => { setDragDraftId(null); setDragOverDate(null); }}
                              className={`w-full rounded-md px-1.5 py-1 text-[10px] font-medium leading-tight group/draft relative ${movable ? "cursor-grab active:cursor-grabbing" : ""}`}
                              style={solid
                                ? { backgroundColor: st.color, color: "#fff" }
                                : { backgroundColor: st.color + "15", borderLeft: `2px solid ${st.color}`, color: "var(--color-chip-ink)" }}
                            >
                              <button onClick={() => (!canEdit || solid) ? openDraft(draft) : setPendingDrop({ draft, date })} className="w-full text-left" title={st.label}>
                                <div className="truncate font-semibold pr-4">{st.key === "booked" ? "🔒 " : st.key === "posted" ? "✓ " : ""}{badge(platformOf(draft))}{draft.title}</div>
                                {draft.concept && <div className={`truncate text-[9px] ${solid ? "text-white/80" : "opacity-70"}`}>💡 {conceptLabel(draft.conceptId, draft.concept.name)}</div>}
                                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                  {(() => { const t = draft.scheduledDate?.match(/T(\d{2}:\d{2})/)?.[1]; return t ? <span className={`rounded px-1 text-[9px] font-semibold ${solid ? "bg-white/20 text-white" : "bg-surface-3 text-ink-2"}`}>🕐 {t}</span> : null; })()}
                                  {!solid && <span className="rounded px-1 text-[9px]" style={{ backgroundColor: st.color + "22", color: st.color }}>{st.label}</span>}
                                  {draft.stage && <span className={`rounded px-1 text-[9px] ${solid ? "bg-white/20 text-white" : "bg-surface-3 text-muted"}`}>📍 {draft.stage.name}</span>}
                                </div>
                              </button>
                              <button
                                onClick={() => unscheduleDraft(draft.id)}
                                className={`absolute top-0.5 right-0.5 opacity-0 group-hover/draft:opacity-100 transition-all leading-none text-[11px] w-4 h-4 flex items-center justify-center ${solid ? "text-white/70 hover:text-white" : "text-faint hover:text-danger-500"}`}
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
            <div className="grid grid-cols-7 divide-x divide-line">
              {weekDays.map((date, i) => {
                const pieces = content.filter((c) => c.scheduledDate?.startsWith(date));
                const draftsOnDay = scheduledDrafts.filter((d) => d.scheduledDate?.startsWith(date));
                const isToday = date === todayStr;
                const isDragTargetWeek = date === dragOverDate && dragDraftId !== null;
                const templateHints = templateHintsFor(i);
                const d = new Date(date);
                return (
                  <div
                    key={date}
                    className={`min-h-[420px] p-2 flex flex-col transition-colors ${isToday ? "bg-accent-tint/40" : ""} ${isDragTargetWeek ? "bg-accent-tint/60 ring-2 ring-inset ring-accent" : ""}`}
                    onDragOver={canEdit ? (e) => { e.preventDefault(); setDragOverDate(date); } : undefined}
                    onDragLeave={() => setDragOverDate(null)}
                    onDrop={canEdit ? () => handleCalendarDrop(date) : undefined}
                  >
                    <div className={`text-center mb-2`}>
                      <p className="text-[10px] font-semibold text-faint uppercase">{DAYS[i]}</p>
                      <span className={`text-sm font-bold w-8 h-8 flex items-center justify-center rounded-full mx-auto ${isToday ? "bg-accent text-on-accent" : "text-ink-2"}`}>
                        {d.getDate()}
                      </span>
                    </div>
                    {/* Template hint — one per platform with a concept that day */}
                    {templateHints.map((h) => (
                      <div key={h.platform} className="mb-2 px-2 py-1 rounded-lg text-[10px] text-muted bg-surface-2 border border-dashed border-line text-center truncate">
                        💡 {badge(h.platform)}{conceptLabel(h.concept.id, h.concept.name)}
                      </div>
                    ))}
                    <div className="flex-1 space-y-1.5">
                      {pieces.map((piece) => {
                        const isPosted = piece.status === "posted" || !!piece.igMediaId;
                        return (
                          <button
                            key={piece.id}
                            onClick={(isClient && onOpenInKanban) ? undefined : () => setSelected(piece)}
                            className="w-full text-left rounded-lg px-2 py-2 text-xs hover:opacity-90 transition-opacity"
                            style={isPosted ? {
                              backgroundColor: "var(--color-chip-posted-bg)",
                              borderLeft: "3px solid #16a34a",
                            } : {
                              backgroundColor: (piece.client?.color || "#6366f1") + "18",
                              borderLeft: `3px solid ${piece.client?.color || "#6366f1"}`,
                            }}
                          >
                            <p className={`font-semibold truncate leading-snug ${isPosted ? "text-ok-800" : "text-ink"}`}>{badge(platformOf(piece))}{piece.title}</p>
                            {piece.concept && <p className={`truncate text-[10px] mt-0.5 ${isPosted ? "text-ok-600" : "text-faint"}`}>💡 {conceptLabel(piece.conceptId, piece.concept.name)}</p>}
                            <div className="mt-1">
                              {isPosted
                                ? <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-ok-700 bg-ok-100 rounded px-1.5 py-0.5">✓ Posted</span>
                                : <StatusBadge status={piece.status} />
                              }
                            </div>
                          </button>
                        );
                      })}
                      {draftsOnDay.map((draft) => {
                        const st = draftState(draft);
                        const solid = st.key === "booked" || st.key === "posted";
                        const movable = canEdit && (st.key === "planned" || st.key === "edited" || st.key === "ready");
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
                          <button onClick={() => (!canEdit || solid) ? openDraft(draft) : setPendingDrop({ draft, date })} className="w-full text-left" title={st.label}>
                            <p className="font-semibold truncate leading-snug pr-4" style={{ color: solid ? "#fff" : st.color }}>{st.key === "booked" ? "🔒 " : st.key === "posted" ? "✓ " : ""}{badge(platformOf(draft))}{draft.title}</p>
                            {draft.concept && <p className={`truncate text-[10px] ${solid ? "text-white/80" : "text-muted"}`}>💡 {conceptLabel(draft.conceptId, draft.concept.name)}</p>}
                            {(() => { const t = draft.scheduledDate?.match(/T(\d{2}:\d{2})/)?.[1]; return t ? <p className={`text-[10px] font-semibold ${solid ? "text-white/90" : "text-ink-2"}`}>🕐 {t}</p> : null; })()}
                            {!solid && <p className="text-[10px] mt-0.5" style={{ color: st.color }}>{st.label}</p>}
                            {draft.stage && <p className={`truncate text-[10px] ${solid ? "text-white/70" : "text-faint"}`}>📍 {draft.stage.name}</p>}
                          </button>
                          <button
                            onClick={() => unscheduleDraft(draft.id)}
                            className={`absolute top-1 right-1 opacity-0 group-hover/wdraft:opacity-100 transition-all text-sm leading-none ${solid ? "text-white/70 hover:text-white" : "text-faint hover:text-danger-500"}`}
                            title="Remove from calendar"
                          >×</button>
                        </div>
                      );})}
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => setShowAdd(true)}
                        className="mt-2 w-full text-[10px] text-faint hover:text-accent hover:bg-accent-tint rounded py-1 transition-colors text-center"
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
        <div className="bg-surface rounded-2xl border border-line overflow-hidden">
          <div className="px-5 py-3 border-b border-line flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-ink-2">Schedule Board</h2>
              <span className="text-[10px] text-faint bg-surface-3 px-2 py-0.5 rounded-full">
                drag onto calendar to schedule
              </span>
            </div>
            <div className="flex items-center gap-3 relative">
              <button
                onClick={() => setBoardColumnPicker((v) => !v)}
                className="text-xs text-muted hover:text-accent font-medium flex items-center gap-1"
              >
                ⚙ Columns
              </button>
              {boardColumnPicker && (
                <div className="absolute right-16 top-full mt-1 bg-surface border border-line rounded-xl o-elev-lift z-50 p-3 min-w-[180px]" onClick={(e) => e.stopPropagation()}>
                  <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-2">Show columns</p>
                  {allColumnKeys.map((col) => (
                    <label key={col} className="flex items-center gap-2 py-1 cursor-pointer hover:bg-surface-2 rounded px-1">
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
                      <span className="text-xs text-ink-2">{columnLabel(col)}</span>
                    </label>
                  ))}
                </div>
              )}
              <button
                onClick={() => setShowScheduleBoard((v) => !v)}
                className="text-xs text-faint hover:text-ink-2"
              >
                {showScheduleBoard ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          {showScheduleBoard && (() => {
            const unscheduled = stagedDrafts.filter((d) => !d.scheduledDate);
            if (boardColumns.length === 0) {
              return <p className="px-5 py-8 text-center text-sm text-faint">No columns selected — click ⚙ Columns to choose which to show.</p>;
            }
            if (stagedDrafts.length === 0) {
              return <p className="px-5 py-8 text-center text-sm text-faint">No scripts yet — generate scripts in the Kanban first.</p>;
            }
            // Group by selected columns (show even if empty). Columns are per platform: an
            // "Edit" column only ever holds drafts of ITS platform (stage ids are platform-specific,
            // and Ideas is filtered by the draft's platform).
            const grouped: { key: string; label: string; color: string; drafts: ScriptDraft[] }[] = [];
            for (const p of platforms) {
              const ideasKey = colKey(p, "Ideas");
              if (boardColumns.includes(ideasKey)) {
                grouped.push({ key: ideasKey, label: columnLabel(ideasKey), color: "#a855f7", drafts: unscheduled.filter((d) => !d.stageId && platformOf(d) === p) });
              }
              stagesFor(p).filter((st) => boardColumns.includes(colKey(p, st.name))).forEach((st) => {
                grouped.push({ key: colKey(p, st.name), label: columnLabel(colKey(p, st.name)), color: st.color, drafts: unscheduled.filter((d) => d.stageId === st.id) });
              });
            }
            return (
              <div className="overflow-x-auto">
                <div className="flex gap-0 min-w-max">
                  {grouped.map((group) => (
                    <div key={group.key} className="w-56 border-r border-line last:border-r-0 flex-shrink-0">
                      <div className="px-3 py-2 border-b border-line flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: group.color }} />
                        <span className="text-xs font-semibold text-ink-2 truncate">{group.label}</span>
                        <span className="ml-auto text-[10px] text-faint">{group.drafts.length}</span>
                      </div>
                      <div className="p-2 space-y-1.5 max-h-56 overflow-y-auto">
                        {group.drafts.map((draft) => (
                          <div
                            key={draft.id}
                            draggable={canEdit}
                            onDragStart={canEdit ? () => handleDraftDragStart(draft.id) : undefined}
                            onDragEnd={() => { setDragDraftId(null); setDragOverDate(null); }}
                            onClick={() => setSelectedDraft(draft)}
                            className={`rounded-lg border border-line bg-surface-2 px-2.5 py-2 cursor-pointer ${canEdit ? "active:cursor-grabbing hover:border-accent hover:bg-accent-tint" : ""} transition-colors select-none`}
                          >
                            <p className="text-xs font-semibold text-ink truncate leading-snug">{draft.title}</p>
                            {draft.concept && (
                              <p className="text-[10px] text-accent truncate mt-0.5">💡 {conceptLabel(draft.conceptId, draft.concept.name)}</p>
                            )}
                            <p className="text-[10px] text-faint mt-0.5">{draft.weekLabel}{(draft.editedVideoUrl ? " · 🎬" : "")}</p>
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

      {showPost && selectedClientId && (
        <PostModal
          clientId={selectedClientId}
          platform={showPost}
          onClose={() => setShowPost(null)}
          onPosted={() => { reload(); setShowPost(null); }}
        />
      )}

      {showAdd && (
        <AddContentModal
          clients={clients}
          concepts={concepts}
          stages={stages}
          platforms={platforms}
          selectedClientId={selectedClientId}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); reload(); }}
        />
      )}

      {selected && (
        <ContentDetailModal
          piece={selected}
          platform={platformOf(selected)}
          showPlatform={multi}
          stages={stagesFor(platformOf(selected))}
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
        <ScriptDraftModal draft={selectedDraft} onClose={() => setSelectedDraft(null)}
          onCancelScheduled={async () => { await unscheduleDraft(selectedDraft.id); setSelectedDraft(null); }} />
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
      {pendingDrop && canEdit && (() => {
        // Everything about "ready to post" is judged against the draft's OWN platform's stages.
        const dp = platformOf(pendingDrop.draft);
        const ps = stagesFor(dp);
        return (
        <ConfirmScheduleModal
          draft={pendingDrop.draft}
          platform={dp}
          date={pendingDrop.date}
          clientId={selectedClientId}
          canPost={!!ps.length && pendingDrop.draft.stageId === ps[ps.length - 1]?.id}
          lastStageName={ps[ps.length - 1]?.name ?? "Schedule"}
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
                  platform: dp,
                  content: opts.caption,
                  mediaUrls: mediaUrl ? [mediaUrl] : [],
                  scheduledFor: new Date(`${pendingDrop.date}T${opts.time || "09:00"}:00`).toISOString(),
                  scriptDraftId: pendingDrop.draft.id,
                  trialReel: dp === "instagram" && opts.trialReel,
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
        );
      })()}
    </div>
  );

  // Template concepts for a weekday, one entry per enabled platform that has one set.
  function templateHintsFor(dow: number): { platform: PlatformId; concept: Concept }[] {
    const out: { platform: PlatformId; concept: Concept }[] = [];
    for (const p of platforms) {
      const id = dayTemplate[p]?.[dow];
      const c = id ? concepts.find((x) => x.id === id) : null;
      if (c) out.push({ platform: p, concept: c });
    }
    return out;
  }
}

// ── Script Draft Modal (read-only view from calendar) ───────────────────────

function ScriptDraftModal({ draft, onClose, onCancelScheduled }: { draft: ScriptDraft; onClose: () => void; onCancelScheduled?: () => void | Promise<void> }) {
  const [cancelling, setCancelling] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-surface rounded-2xl o-elev-pop w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            {draft.concept && <p className="text-xs font-semibold text-accent mb-0.5">💡 {draft.concept.conceptType ? `${draft.concept.conceptType} · ${draft.concept.name}` : draft.concept.name}</p>}
            <h2 className="text-base font-bold text-ink">{draft.title}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {draft.stage && <span className="text-[10px] bg-surface-3 text-muted rounded-full px-2 py-0.5">📍 {draft.stage.name}</span>}
              <span className="text-[10px] text-faint">{draft.weekLabel}</span>
            </div>
          </div>
          <button onClick={onClose} className="text-faint hover:text-ink-2 text-xl leading-none ml-4">×</button>
        </div>
        {draft.hook && (
          <div>
            <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Text Hook</p>
            <p className="text-sm text-ink-2 bg-surface-2 rounded-lg px-3 py-2">{draft.hook}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Script</p>
          <pre className="text-sm text-ink-2 bg-surface-2 rounded-lg px-3 py-2 whitespace-pre-wrap font-sans leading-relaxed">{draft.script}</pre>
          <p className="text-[10px] text-faint mt-1">{draft.script.split(" ").filter(Boolean).length} words</p>
        </div>
        {draft.caption && (
          <div>
            <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Caption</p>
            <pre className="text-sm text-ink-2 bg-surface-2 rounded-lg px-3 py-2 whitespace-pre-wrap font-sans leading-relaxed">{draft.caption}</pre>
          </div>
        )}
        {draft.editedVideoUrl && (
          <div>
            <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Finished Video</p>
            <div className="rounded-xl overflow-hidden bg-slate-900 aspect-video">
              <video src={videoSrc(draft.editedVideoUrl)} controls className="w-full h-full object-contain" />
            </div>
          </div>
        )}
        {(() => {
          // Once scheduled, the raw clips are noise — only the finished video + caption + info matter.
          const isScheduled = /schedul/i.test(draft.stage?.name || "");
          if (isScheduled) return null;
          let raw: string[] = [];
          try { raw = JSON.parse(draft.rawContentUrls || "[]"); } catch { /* ignore */ }
          if (draft.rawContentUrl && !raw.includes(draft.rawContentUrl)) raw = [draft.rawContentUrl, ...raw];
          if (raw.length === 0) return null;
          return (
            <div>
              <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Raw Content ({raw.length})</p>
              <div className="space-y-2">
                {raw.map((url, i) => (
                  /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(url)
                    ? <video key={i} src={url} controls className="w-full rounded-lg bg-slate-900 max-h-60 object-contain" />
                    : <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block text-xs text-accent hover:underline truncate bg-surface-2 rounded-lg px-3 py-2">📎 {url.split("/").pop()}</a>
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
          <div className="flex items-center gap-2 text-xs text-muted bg-surface-2 rounded-lg px-3 py-2">
            <span>📅</span>
            <span>{draft.zernioBooked ? `Scheduled to auto-post · ${when}` : `Planned · ${when} (not yet confirmed)`}</span>
          </div>
          );})()}
        {draft.zernioBooked && onCancelScheduled && (
          <button
            onClick={async () => { if (!confirm("Cancel this scheduled post? It will be removed from auto-posting on Zernio too.")) return; setCancelling(true); try { await onCancelScheduled(); } finally { setCancelling(false); } }}
            disabled={cancelling}
            className="w-full py-2.5 text-sm font-semibold text-danger-600 bg-danger-50 border border-danger-200 rounded-xl hover:bg-danger-100 disabled:opacity-50">
            {cancelling ? "Cancelling…" : "✕ Cancel scheduled post"}
          </button>
        )}
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
      <div className="bg-surface rounded-2xl o-elev-pop w-full max-w-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-bold text-ink">Plan for {pretty}</h2>
          <p className="text-xs text-faint mt-0.5">Pick the time you want this to go out.</p>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-muted uppercase tracking-wide mb-1">Time (local)</label>
          <input type="time" value={time} autoFocus onChange={(e) => setTime(e.target.value)}
            className="w-full border border-line rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-muted hover:bg-surface-3 rounded-lg">Cancel</button>
          <button onClick={() => onPlan(time || "09:00")} disabled={!time}
            className="px-4 py-2 text-sm font-semibold text-on-accent bg-accent rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed">
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
  draft, platform, date, clientId, canPost, lastStageName, onClose, onConfirm,
}: {
  draft: ScriptDraft;
  platform: PlatformId; // the draft's platform — drives the caption prompt, labels and Zernio target
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
  const [captionCopied, setCaptionCopied] = useState(false);
  const [trialReel, setTrialReel] = useState(false);
  const [genCaption, setGenCaption] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showVideoQR, setShowVideoQR] = useState(false);
  const [scheduleTime, setScheduleTime] = useState(() => {
    const m = (draft.scheduledDate || "").match(/T(\d{2}:\d{2})/);
    return m ? m[1] : "09:00";
  });
  const platformLabel = PLATFORM_LABEL[platform];
  const platformBadge = PLATFORM_BADGE[platform];

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
        body: JSON.stringify({ clientId, hook: draft.hook, script: draft.script, platform }),
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
      <div className="bg-surface rounded-2xl o-elev-pop w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-line flex items-start justify-between">
          <div>
            {draft.concept && <p className="text-xs font-semibold text-accent mb-0.5">💡 {draft.concept.conceptType ? `${draft.concept.conceptType} · ${draft.concept.name}` : draft.concept.name}</p>}
            <h2 className="text-base font-bold text-ink">{draft.title}</h2>
            <p className="text-xs text-faint mt-0.5">Scheduling for <span className="font-semibold text-ink-2">{date}</span></p>
          </div>
          <button onClick={onClose} className="text-faint hover:text-ink-2 text-xl leading-none ml-4 mt-0.5">×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Hook (read-only) */}
          {draft.hook && (
            <div>
              <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Hook</p>
              <p className="text-sm text-ink-2 bg-surface-2 rounded-lg px-3 py-2">{draft.hook}</p>
            </div>
          )}

          {/* Script (read-only, collapsed) */}
          <div>
            <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Script</p>
            <pre className="text-sm text-ink-2 bg-surface-2 rounded-lg px-3 py-2 whitespace-pre-wrap font-sans leading-relaxed max-h-32 overflow-y-auto">{draft.script}</pre>
          </div>

          {/* Finished video preview */}
          {videoUrl && (
            <div>
              <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Video</p>
              {isVideo ? (
                <div className="rounded-xl overflow-hidden bg-slate-900 aspect-video">
                  <video src={videoSrc(videoUrl)} controls className="w-full h-full object-contain" />
                </div>
              ) : (
                <img src={videoUrl} alt="" className="rounded-xl w-full object-cover max-h-64" />
              )}

              {/* Shareable link to the finished video — same as the Kanban schedule stage, so
                  you can hand the file to whoever posts it (or scan it onto a phone). */}
              <div className="flex items-center gap-2 mt-2">
                <input readOnly value={videoUrl} onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 border border-line rounded-lg px-2 py-1.5 text-[11px] text-muted truncate" />
                <button
                  onClick={async () => { try { await navigator.clipboard.writeText(videoUrl); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); } catch { /* ignore */ } }}
                  className="px-2.5 py-1.5 text-[11px] font-semibold bg-surface-3 text-ink-2 rounded-lg hover:bg-surface-4 whitespace-nowrap">
                  {linkCopied ? "✓" : "🔗 Video"}
                </button>
                <button onClick={() => setShowVideoQR((s) => !s)} title="Show QR to open on phone"
                  className="px-2.5 py-1.5 text-[11px] font-semibold bg-surface-3 text-ink-2 rounded-lg hover:bg-surface-4 whitespace-nowrap">📱</button>
              </div>
              {showVideoQR && (
                <div className="flex flex-col items-center gap-1 bg-surface border border-line rounded-xl p-3 mt-2">
                  <QRCodeSVG value={videoUrl} size={140} />
                  <p className="text-[10px] text-faint">Scan to open the video on your phone</p>
                </div>
              )}
            </div>
          )}

          {/* Caption — editable, with AI auto-generate */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] font-semibold text-faint uppercase tracking-wide">Caption</p>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-faint">{caption.length} chars</span>
                <button
                  onClick={async () => {
                    try {
                      // Instagram (and many chat apps) collapse blank lines. Put an invisible
                      // braille-blank char on otherwise-empty lines so the paragraph spacing survives.
                      const igSafe = caption.split("\n").map((l) => (l.trim() === "" ? "⠀" : l)).join("\n");
                      await navigator.clipboard.writeText(igSafe);
                      setCaptionCopied(true);
                      setTimeout(() => setCaptionCopied(false), 1500);
                    } catch { /* ignore */ }
                  }}
                  disabled={!caption}
                  className="text-[10px] font-semibold text-ink-2 hover:text-ink disabled:opacity-40">
                  {captionCopied ? "✓ Copied" : "📋 Copy"}
                </button>
                <button onClick={() => autoGenerateCaption()} disabled={genCaption}
                  className="text-[10px] font-semibold text-accent hover:text-accent-strong disabled:opacity-50">
                  {genCaption ? "Generating…" : "✨ Auto-generate caption"}
                </button>
              </div>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={4}
              placeholder={genCaption ? "✨ Generating caption…" : `Write your ${platformLabel} caption here…`}
              className="w-full text-sm text-ink-2 bg-surface-2 border border-line rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {/* Trial reel toggle (Instagram-only feature) */}
          {hasMedia && platform === "instagram" && (
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input type="checkbox" checked={trialReel} onChange={(e) => setTrialReel(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-line-2 text-accent focus:ring-accent" />
              <span className="text-xs text-ink-2 leading-relaxed">
                <span className="font-semibold text-ink-2">🧪 Post as trial reel</span> — shown only to non-followers first;
                auto-shares to followers if it performs well.
              </span>
            </label>
          )}

          {/* Posting time */}
          {hasMedia && (
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Date</label>
                <div className="text-sm text-ink-2 bg-surface-2 border border-line rounded-lg px-3 py-2">{date}</div>
              </div>
              <div className="w-32">
                <label className="block text-[10px] font-semibold text-faint uppercase tracking-wide mb-1">Time (local)</label>
                <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent" />
              </div>
            </div>
          )}

          {/* Zernio posting indicator */}
          {hasMedia && canPost && (
            <div className="flex items-start gap-2 bg-accent-tint rounded-xl px-4 py-3">
              <span className="text-accent mt-0.5">📡</span>
              <p className="text-[11px] text-accent-strong">Hit <span className="font-semibold">Confirm &amp; Schedule</span> to book this {platformLabel} auto-post via Zernio for {scheduleTime} on {date}.</p>
            </div>
          )}

          {igStatus && (
            <p className={`text-sm font-medium text-center ${igStatus.includes("✓") ? "text-ok-600" : igStatus.includes("Failed") ? "text-danger-500" : "text-accent"}`}>
              {igStatus}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-line flex gap-3">
          <button
            onClick={() => handle(false)}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-xl border border-line text-sm font-semibold text-ink-2 hover:bg-surface-2 disabled:opacity-50 transition-colors"
          >
            Save to Calendar
          </button>
          {(() => {
            const isFuture = new Date(`${date}T${scheduleTime || "09:00"}:00`).getTime() > Date.now() + 60_000;
            return (
            <button
              onClick={() => handle(true)}
              disabled={loading || !hasMedia || !canPost}
              title={!canPost ? `Move this to the "${lastStageName}" stage first` : !hasMedia ? `Upload a video/photo in the Kanban first to enable ${platformLabel} posting` : ""}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-accent to-pink-500 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {loading ? (isFuture ? "Scheduling…" : "Posting…") : (isFuture ? "🗓 Confirm & Schedule" : `${platformBadge} Post now`)}
            </button>
            );
          })()}
        </div>
        {!canPost && (
          <p className="px-6 pb-4 text-[11px] text-warn-600 text-center">
            🔒 Not ready to schedule — move this to the <span className="font-semibold">{lastStageName}</span> stage in the Kanban (it&apos;s in {draft.stage?.name ? `"${draft.stage.name}"` : "an earlier stage"}) before you can book the auto-post. You can still keep it planned here.
          </p>
        )}
        {canPost && !hasMedia && (
          <p className="px-6 pb-4 text-[11px] text-faint text-center">
            Upload a video or photo in the Kanban stage to enable direct {platformLabel} posting.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Post Modal (Buffer-style direct scheduling, one platform at a time) ──────

// Upload to Cloudflare R2 via a presigned PUT (Cloudinary is gone). A single PUT handles up
// to 5GB — fine for any IG reel — and R2 has no credit limit to lock us out.
function igUpload(file: File, onProgress: (pct: number) => void): Promise<string> {
  return new Promise(async (resolve, reject) => {
    let presign: { uploadUrl: string; publicUrl: string };
    try {
      const r = await fetch("/api/r2/presign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name || "video.mp4", contentType: file.type || "video/mp4" }),
      });
      const d = await r.json();
      if (!r.ok || !d.uploadUrl) { reject(new Error(d.error || `Couldn't start upload (${r.status})`)); return; }
      presign = d;
    } catch { reject(new Error("Network error")); return; }

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", presign.uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => { (xhr.status >= 200 && xhr.status < 300) ? resolve(presign.publicUrl) : reject(new Error(`Upload failed (${xhr.status})`)); };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(file);
  });
}

function PostModal({ clientId, platform, onClose, onPosted }: { clientId: number; platform: PlatformId; onClose: () => void; onPosted: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const today = ymdLocal(new Date());
  const nowTime = new Date().toTimeString().slice(0, 5);
  const platformLabel = PLATFORM_LABEL[platform];
  const platformBadge = PLATFORM_BADGE[platform];

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
      const title = caption.split("\n")[0].trim().slice(0, 80) || `${platformLabel} Post – ${scheduleDate}`;
      const contentRes = await fetch("/api/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          title,
          caption,
          rawContentUrl: mediaUrl,
          platform,
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
        body: JSON.stringify({ clientId, platform, content: caption, mediaUrls: [mediaUrl], scheduledFor, contentPieceId: newPieceId, trialReel: platform === "instagram" && trialReel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? `Failed to post to ${platformLabel}`);
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
        className="bg-surface rounded-2xl o-elev-pop w-full max-w-lg max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">{platformBadge}</span>
            <h2 className="text-base font-bold text-ink">Post to {platformLabel}</h2>
          </div>
          <button onClick={onClose} className="text-faint hover:text-ink-2 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Media upload */}
          <div>
            <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-2">Video / Photo</p>
            <input ref={fileRef} type="file" accept="video/*,image/*" className="hidden" onChange={handleFile} />
            {mediaUrl ? (
              <div className="flex items-center gap-3 bg-ok-50 rounded-xl px-4 py-3">
                <span className="text-ok-500 text-lg">✓</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ok-700 truncate">{mediaName}</p>
                  <p className="text-[10px] text-ok-500 truncate">{mediaUrl}</p>
                </div>
                <button
                  onClick={() => { setMediaUrl(null); setMediaName(""); }}
                  className="text-xs text-faint hover:text-ink-2 shrink-0"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileRef.current?.click()}
                disabled={isLoading}
                className="w-full border-2 border-dashed border-line rounded-xl py-8 flex flex-col items-center gap-2 text-faint hover:border-accent hover:text-accent transition-colors"
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
              <p className="text-[10px] font-semibold text-faint uppercase tracking-wide">Caption</p>
              <span className="text-[10px] text-faint">{caption.length} chars</span>
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={5}
              placeholder="Write your caption, add hashtags…"
              className="w-full text-sm text-ink-2 bg-surface-2 border border-line rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {/* Schedule date + time */}
          <div>
            <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-2">Schedule</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-muted mb-1">Date</label>
                <input
                  type="date"
                  value={scheduleDate}
                  min={today}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div className="w-32">
                <label className="block text-xs text-muted mb-1">Time (local)</label>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-full text-sm border border-line rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>

            {/* Trial reel toggle (Instagram-only feature) */}
            {platform === "instagram" && (
              <label className="mt-3 flex items-start gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={trialReel} onChange={(e) => setTrialReel(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-line-2 text-accent focus:ring-accent" />
                <span className="text-xs text-ink-2 leading-relaxed">
                  <span className="font-semibold text-ink-2">🧪 Post as trial reel</span> — shown only to non-followers first;
                  Instagram auto-shares it to your followers if it performs well. (Video reels only.)
                </span>
              </label>
            )}
          </div>

          {/* Status */}
          {status === "done" && (
            <div className="flex items-center gap-2 bg-ok-50 rounded-xl px-4 py-3">
              <span className="text-ok-500">✓</span>
              <p className="text-sm font-medium text-ok-700">
                {postedNow ? `Sent to ${platformLabel} — should appear shortly!` : `Scheduled for ${scheduleDate} at ${scheduleTime}`}
              </p>
            </div>
          )}
          {(status === "error" || errorMsg) && (
            <p className="text-sm text-danger-500 font-medium">{errorMsg}</p>
          )}
        </div>

        {/* Actions */}
        {status !== "done" && (
          <div className="px-6 py-4 border-t border-line flex gap-3">
            <button
              onClick={() => handlePost(false)}
              disabled={isLoading || !mediaUrl}
              title={!mediaUrl ? "Upload media first" : ""}
              className="flex-1 px-4 py-2.5 rounded-xl border border-line text-sm font-semibold text-ink-2 hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {status === "posting" ? "Scheduling…" : "🗓 Schedule"}
            </button>
            <button
              onClick={() => handlePost(true)}
              disabled={isLoading || !mediaUrl}
              title={!mediaUrl ? "Upload media first" : ""}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-accent to-pink-500 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {status === "posting" ? "Posting…" : `${platformBadge} Post Now`}
            </button>
          </div>
        )}
        {status === "done" && (
          <div className="px-6 py-4 border-t border-line">
            <button
              onClick={onClose}
              className="w-full px-4 py-2.5 rounded-xl bg-accent text-on-accent text-sm font-semibold hover:bg-accent-strong transition-colors"
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
        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-line bg-surface hover:bg-surface-2 text-sm font-medium text-ink-2 transition-colors"
      >
        <span>{currentMode.icon}</span>
        <span>{currentMode.label}</span>
        <span className="text-faint text-xs ml-1">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-64 bg-surface border border-line rounded-2xl o-elev-lift z-40 overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">Planning Mode</p>
          </div>
          <div className="p-2 space-y-1">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setPending(m.value)}
                className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${pending === m.value ? "bg-accent-tint border border-accent-tint" : "hover:bg-surface-2 border border-transparent"}`}
              >
                <span className="text-lg mt-0.5">{m.icon}</span>
                <div>
                  <p className={`text-sm font-semibold ${pending === m.value ? "text-accent-strong" : "text-ink-2"}`}>{m.label}</p>
                  <p className="text-xs text-faint mt-0.5">{m.desc}</p>
                </div>
                {pending === m.value && <span className="ml-auto text-accent mt-1">✓</span>}
              </button>
            ))}
          </div>
          <div className="px-3 pb-3 flex gap-2">
            <button
              onClick={() => setOpen(false)}
              className="flex-1 py-2 text-sm text-muted hover:bg-surface-3 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={pending === current}
              className="flex-1 py-2 text-sm font-semibold bg-accent text-on-accent rounded-lg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
  clients, concepts, stages, platforms, selectedClientId, onClose, onSaved,
}: {
  clients: Client[];
  concepts: Concept[];   // merged across enabled platforms — filtered by the chosen platform below
  stages: WorkflowStage[]; // merged across enabled platforms — filtered by the chosen platform below
  platforms: PlatformId[]; // exactly the client's enabled platforms
  selectedClientId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const activeClient = clients.find((c) => c.id === selectedClientId) ?? null;
  const stagesFor = (p: PlatformId) => stages.filter((s) => platformOf(s) === p);
  // Default to the client's primary platform when it's enabled, else the first enabled one.
  const defaultPlatform: PlatformId = isPlatformId(activeClient?.platform) && platforms.includes(activeClient!.platform as PlatformId)
    ? (activeClient!.platform as PlatformId) : platforms[0];

  const [form, setForm] = useState({
    clientId: selectedClientId?.toString() || (clients[0]?.id?.toString() ?? ""),
    conceptId: "", title: "", contentType: "video",
    platform: defaultPlatform as string,
    status: "scripted", scheduledDate: "", hook: "", caption: "", script: "", notes: "",
    currentStageId: stagesFor(defaultPlatform)[0]?.id?.toString() || "",
  });
  const [generatingCaption, setGeneratingCaption] = useState(false);
  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }
  const formPlatform = platformOf({ platform: form.platform });
  // Switching platform resets the concept + starting stage, which are platform-scoped.
  function setPlatform(p: string) {
    const stage = stagesFor(platformOf({ platform: p }))[0];
    setForm((f) => ({ ...f, platform: p, conceptId: "", currentStageId: stage?.id?.toString() || "" }));
  }
  const platformConcepts = concepts.filter((c) => platformOf(c) === formPlatform);

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
              <p className="text-sm font-semibold text-ink">{activeClient.name}</p>
              <p className="text-xs text-muted capitalize">{activeClient.platform}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Title *</label>
              <input required value={form.title} onChange={(e) => set("title", e.target.value)}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink-2 mb-1">Client *</label>
              <select required value={form.clientId} onChange={(e) => set("clientId", e.target.value)}
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                <option value="">Select client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {activeClient && (
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Title *</label>
            <input required value={form.title} onChange={(e) => set("title", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Type</label>
            <select value={form.contentType} onChange={(e) => set("contentType", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
              {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Platform</label>
            <select value={form.platform} onChange={(e) => setPlatform(e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
              {platforms.map((p) => <option key={p} value={p}>{PLATFORM_BADGE[p]} {PLATFORM_LABEL[p]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Status</label>
            <select value={form.status} onChange={(e) => set("status", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Scheduled Date</label>
            <input type="date" value={form.scheduledDate} onChange={(e) => set("scheduledDate", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-2 mb-1">Concept</label>
            <select value={form.conceptId} onChange={(e) => set("conceptId", e.target.value)}
              className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent">
              <option value="">No concept</option>
              {platformConcepts.map((c) => <option key={c.id} value={c.id}>{(c as any).conceptType ? `${(c as any).conceptType} · ${c.name}` : c.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Text Hook</label>
          <input value={form.hook} onChange={(e) => set("hook", e.target.value)}
            placeholder="The opening hook text..."
            className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Script</label>
          <textarea rows={5} value={form.script} onChange={(e) => set("script", e.target.value)}
            className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent font-mono" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-ink-2">Caption</label>
            <button type="button" onClick={generateCaption} disabled={generatingCaption || (!form.script && !form.hook)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-accent-tint text-accent hover:bg-accent-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {generatingCaption ? <><span className="animate-spin">⟳</span> Generating…</> : <>✨ Auto Generate</>}
            </button>
          </div>
          <textarea rows={4} value={form.caption} onChange={(e) => set("caption", e.target.value)}
            placeholder="Caption for the post… or click Auto Generate after writing your script."
            className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-2 mb-1">Notes</label>
          <textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)}
            className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-ink-2 hover:bg-surface-3 rounded-lg">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-accent text-on-accent rounded-xl hover:bg-accent-strong">Save</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Content Detail Modal ────────────────────────────────────────────────────

function ContentDetailModal({
  piece, platform, showPlatform, stages, team, clients, onClose, onStatusChange, onAdvanceStage, onDelete, onSaved,
}: {
  piece: ContentPiece;
  platform: PlatformId;      // the piece's platform (null → Instagram)
  showPlatform: boolean;     // badge the platform (only when the calendar merges several)
  stages: WorkflowStage[];   // ONLY this platform's stages, in order
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
  const platformLabel = PLATFORM_LABEL[platform];
  const platformBadge = PLATFORM_BADGE[platform];

  async function postNow() {
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
          platform,
          content: caption,
          mediaUrls: [videoUrl],
          scheduledFor: new Date().toISOString(),
          contentPieceId: piece.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setIgPostMsg({ ok: false, text: data.message || data.error || "Posting failed" });
      } else {
        // Mark as posted in DB
        await fetch(`/api/content/${piece.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "posted" }),
        });
        onStatusChange("posted");
        setIgPostMsg({ ok: true, text: `✓ Posted to ${platformLabel} via Zernio!` });
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
        body: JSON.stringify({ clientId: piece.clientId, hook: piece.hook, script: piece.script, platform }),
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
          {showPlatform && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-3 text-ink-2">
              {platformBadge} {platformLabel}
            </span>
          )}
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-3 text-ink-2">
            {CONTENT_ICONS[piece.contentType]} {piece.contentType}
          </span>
          {piece.client && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white" style={{ backgroundColor: piece.client.color }}>
              {piece.client.name}
            </span>
          )}
          {piece.concept && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-accent-tint text-accent-strong">
              💡 {(piece.concept as any).conceptType ? `${(piece.concept as any).conceptType} · ${piece.concept.name}` : piece.concept.name}
            </span>
          )}
          {piece.scheduledDate && (() => {
            const dt = new Date(piece.scheduledDate);
            const hasTime = piece.scheduledDate.includes("T");
            const dateStr = dt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
            const timeStr = hasTime ? dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : null;
            return (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-3 text-ink-2">
                📅 {dateStr}{timeStr && <><span className="text-faint">·</span><span className="font-semibold text-accent">🕐 {timeStr}</span></>}
              </span>
            );
          })()}
        </div>

        {stages.length > 0 && (
          <div className="bg-surface-2 rounded-xl p-4">
            <p className="text-xs font-semibold text-muted mb-3">WORKFLOW PROGRESS</p>
            <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
              {stages.map((stage, i) => {
                const isDone = currentStageIndex > i || (piece.status === "posted" && !piece.currentStageId);
                const isCurrent = stage.id === piece.currentStageId;
                return (
                  <div key={stage.id} className="flex items-center gap-1.5 flex-shrink-0">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${isDone ? "bg-ok-500 border-ok-500 text-on-status" : isCurrent ? "border-2 text-white" : "bg-surface border-line-2 text-faint"}`}
                        style={isCurrent ? { backgroundColor: stage.color, borderColor: stage.color } : {}}
                      >
                        {isDone ? "✓" : i + 1}
                      </div>
                      <span className={`text-[10px] mt-1 font-medium max-w-[56px] text-center leading-tight ${isCurrent ? "text-ink" : isDone ? "text-ok-600" : "text-faint"}`}>
                        {stage.name}
                      </span>
                    </div>
                    {i < stages.length - 1 && (
                      <div className={`w-8 h-0.5 flex-shrink-0 ${isDone ? "bg-ok-400" : "bg-surface-4"}`} />
                    )}
                  </div>
                );
              })}
            </div>

            {currentStage && (
              <div className="border border-line rounded-lg p-3 bg-surface space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ backgroundColor: currentStage.color }}>
                    {currentStageIndex + 1}
                  </span>
                  <span className="text-sm font-semibold text-ink">Currently: {currentStage.name}</span>
                  {currentStage.assignedTo && <span className="text-xs text-muted">→ {currentStage.assignedTo.name}</span>}
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Raw Content URL (optional)</label>
                  <input value={rawContentUrl} onChange={(e) => setRawContentUrl(e.target.value)}
                    placeholder="Link to uploaded raw footage / file..."
                    className="w-full border border-line rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Completed by</label>
                  <select value={selectedMember} onChange={(e) => setSelectedMember(e.target.value)}
                    className="w-full border border-line rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent">
                    <option value="">— Select team member —</option>
                    {team.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role ? ` (${m.role})` : ""}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Notes</label>
                  <input value={advanceNotes} onChange={(e) => setAdvanceNotes(e.target.value)}
                    placeholder="Any notes for next stage..."
                    className="w-full border border-line rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-accent" />
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
              <p className="text-xs font-semibold text-faint mb-2 uppercase tracking-wide">Media</p>
              {isVideo ? (
                <video
                  src={url}
                  controls
                  className="w-full rounded-xl border border-line max-h-72 bg-black"
                  preload="metadata"
                />
              ) : (
                <img
                  src={url}
                  alt="Post media"
                  className="w-full rounded-xl border border-line max-h-72 object-cover"
                />
              )}
            </div>
          );
        })()}

        {piece.hook && (
          <div>
            <p className="text-xs font-semibold text-faint mb-1 uppercase tracking-wide">Text Hook</p>
            <div className="bg-accent-tint border border-accent-tint rounded-xl px-4 py-3 text-sm font-medium text-accent-800">{piece.hook}</div>
          </div>
        )}

        {piece.script && (
          <div>
            <p className="text-xs font-semibold text-faint mb-1 uppercase tracking-wide">Script</p>
            <pre className="bg-surface-2 border border-line rounded-xl px-4 py-3 text-sm font-mono whitespace-pre-wrap text-ink-2">{piece.script}</pre>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-semibold text-faint uppercase tracking-wide">Caption</p>
            <div className="flex items-center gap-2">
              {caption && (
                <button onClick={copyCaption} className="text-xs px-2.5 py-1 rounded-lg bg-surface-3 text-ink-2 hover:bg-surface-4 transition-colors">
                  {copied ? "✓ Copied!" : "Copy"}
                </button>
              )}
              <button onClick={generateCaption} disabled={generatingCaption}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-accent-tint text-accent hover:bg-accent-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {generatingCaption ? <><span className="animate-spin inline-block">⟳</span> Generating…</> : <>✨ {caption ? "Regenerate" : "Auto Generate"}</>}
              </button>
            </div>
          </div>
          <textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} onBlur={saveCaption}
            placeholder="Caption for the post… click Auto Generate to create one from your script."
            className="w-full border border-line rounded-xl px-4 py-3 text-sm text-ink-2 focus:outline-none focus:ring-2 focus:ring-accent resize-none" />
        </div>

        {/* Post directly to the piece's platform */}
        {piece.status !== "posted" && (piece.rawContentUrl || rawContentUrl) && (
          <div className="rounded-xl border border-accent-tint bg-accent-tint px-4 py-3 space-y-2">
            <p className="text-[10px] font-semibold text-accent uppercase tracking-wide">{platformLabel}</p>
            <button
              onClick={postNow}
              disabled={igPosting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-accent to-pink-500 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {igPosting ? <><span className="animate-spin inline-block">⟳</span> Posting…</> : `${platformBadge} Post to ${platformLabel} Now`}
            </button>
            {igPostMsg && (
              <p className={`text-xs font-medium text-center ${igPostMsg.ok ? "text-ok-600" : "text-danger-500"}`}>
                {igPostMsg.text}
              </p>
            )}
          </div>
        )}

        <div>
          <p className="text-xs font-semibold text-faint mb-2 uppercase tracking-wide">Update Status</p>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button key={s.value} onClick={() => onStatusChange(s.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${piece.status === s.value ? `${s.bg} ${s.text} border-transparent` : "bg-surface text-ink-2 border-line hover:bg-surface-2"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-between pt-2 border-t border-line">
          <button onClick={onDelete} className="text-sm text-danger-500 hover:text-danger-700">Delete</button>
          <button onClick={onClose} className="px-4 py-2 text-sm bg-surface-3 text-ink-2 rounded-lg hover:bg-surface-4">Close</button>
        </div>
      </div>
    </Modal>
  );
}
