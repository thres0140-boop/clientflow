"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Client, Concept, WorkflowStage, ScriptDraft, TeamMember, Creator } from "@/lib/types";
import { QRCodeSVG } from "qrcode.react";
import SparkMD5 from "spark-md5";
import { markSeen as markSentBackSeen, getSeen as getSentBackSeen } from "@/lib/sentBackSeen";

type Props = {
  clients: Client[];
  selectedClientId: number | null;
  onSelectClient: (id: number | null) => void;
  activeProfileId: number | null;
  activeProfile: TeamMember | null;
  team: TeamMember[];
  ownerName?: string;
  isClient?: boolean;
  onOpenChat?: (context: { id?: number; title: string; hook?: string | null; script: string; caption?: string | null; channel?: string }) => void;
  onBadgesChanged?: () => void;
  highlightDraftId?: number | null; // a draft to scroll to + flash (e.g. when a client taps it on the calendar)
  onHighlightConsumed?: () => void;
};

const WEEK_NUMBER = Math.ceil(
  (Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000)
);

// ─── Posting-day helpers ──────────────────────────────────────────────────────
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JS_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // new Date().getDay() index
const dayOrder = (d: string) => { const i = DOW.indexOf(d); return i === -1 ? 99 : i; };
// Parse a scheduled-date string in LOCAL time. A bare "2026-06-12" parses as UTC midnight
// (off-by-one-day in timezones behind UTC), so force local by adding a time component.
const parseSched = (iso: string) => new Date(iso.includes("T") ? iso : iso + "T00:00:00");

// The posting day(s) for a draft. Priority: an exact scheduled date → that weekday;
// otherwise the concept's planned posting days; otherwise the free-text dayLabel.
function deriveDays(draft: ScriptDraft, conceptPostDays?: string | null): string[] {
  if (draft.scheduledDate) {
    const dt = parseSched(draft.scheduledDate);
    if (!isNaN(dt.getTime())) return [JS_DAY[dt.getDay()]];
  }
  if (conceptPostDays) {
    const arr = conceptPostDays.split(",").map((s) => s.trim()).filter((x) => DOW.includes(x));
    if (arr.length) return arr.sort((a, b) => dayOrder(a) - dayOrder(b));
  }
  if (draft.dayLabel) {
    const cap = draft.dayLabel.trim().slice(0, 1).toUpperCase() + draft.dayLabel.trim().slice(1, 3).toLowerCase();
    if (DOW.includes(cap)) return [cap];
  }
  return [];
}
const primaryDayOrder = (days: string[]) => (days.length ? Math.min(...days.map(dayOrder)) : 99);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Thu · 12 Jun" from a scheduled-date ISO string.
function fmtSchedule(iso?: string | null): string | null {
  if (!iso) return null;
  const dt = parseSched(iso);
  if (isNaN(dt.getTime())) return null;
  return `${JS_DAY[dt.getDay()]} · ${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
}

// ─── Draggable card shell ───────────────────────────────────────────────────
function DraggableCard({ draft, onClick, selected = false, notify = false, days, highlight = false }: { draft: ScriptDraft; onClick: () => void; selected?: boolean; notify?: boolean; days?: string[]; highlight?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: String(draft.id) });
  const style = transform
    ? { transform: `translate(${transform.x}px,${transform.y}px)`, opacity: isDragging ? 0.4 : 1 }
    : {};
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      data-draft-id={draft.id}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="touch-none cursor-grab active:cursor-grabbing outline-none focus:outline-none"
    >
      <CardContent draft={draft} selected={selected} notify={notify} days={days} highlight={highlight} />
    </div>
  );
}

// ─── Card content ────────────────────────────────────────────────────────────
function CardContent({ draft, selected = false, notify = false, days, highlight = false }: { draft: ScriptDraft; selected?: boolean; notify?: boolean; days?: string[]; highlight?: boolean }) {
  return (
    <div className={`relative bg-white rounded-xl border p-3 shadow-sm hover:shadow-md transition-all select-none ${
      highlight ? "ring-4 ring-indigo-400 border-indigo-400 animate-pulse shadow-lg" : notify ? "ring-2 ring-red-400 border-red-400" : selected ? "ring-2 ring-indigo-500 border-indigo-500" : draft.isSavedIdea ? "border-amber-200 bg-amber-50/30" : "border-slate-200"
    }`}>
      {notify && (
        <span className="absolute -top-1.5 -right-1.5 z-10 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow ring-2 ring-white" title="Sent back — needs changes">
          ↩ 1
        </span>
      )}
      {draft.isSavedIdea && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full mb-2">
          ↩ Returning idea
        </span>
      )}
      {draft.clientAuthored && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full mb-2 ml-1">
          ✍️ Client-written
        </span>
      )}
      <p className="text-xs font-semibold text-slate-800 truncate">{draft.title}</p>
      {draft.concept && (
        <p className="text-sm text-indigo-500 font-semibold mt-1 flex items-center gap-1.5 flex-wrap">
          <span>
            {draft.concept.conceptType ? <span className="opacity-70">{draft.concept.conceptType} · </span> : null}
            {draft.concept.name}
          </span>
          {(draft as any).isRemix && (
            <span className="inline-flex items-center text-[9px] font-bold text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded-full">♻️ Remixed</span>
          )}
        </p>
      )}
      <p className="text-[10px] text-slate-400 mt-1 truncate flex items-center gap-1 flex-wrap">
        {fmtSchedule(draft.scheduledDate) ? (
          // Scheduled → show the real posting date (weekday + day of month), not "Week 23".
          <>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-semibold text-[9px]">
              📅 {fmtSchedule(draft.scheduledDate)}
            </span>
            {(() => {
              // Only flag it Planned/Scheduled if the date is today or in the FUTURE — a past
              // date isn't an upcoming plan.
              const sd = draft.scheduledDate!;
              const t = new Date(sd.includes("T") ? sd : sd + "T00:00:00").getTime();
              const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
              if (t < startToday.getTime()) return null;
              return (draft as any).zernioBooked ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-bold text-[9px]">✓ Scheduled</span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold text-[9px]">🕓 Planned</span>
              );
            })()}
          </>
        ) : (
          // Not scheduled yet → keep the week label + planned weekday (if any).
          <>
            <span>{draft.weekLabel}</span>
            {days && days.length > 0 ? (
              days.map((d) => (
                <span key={d} className="inline-block px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-500 font-semibold text-[9px]">{d}</span>
              ))
            ) : draft.dayLabel ? (
              <span>· {draft.dayLabel}</span>
            ) : (
              <span className="text-amber-500">· no date</span>
            )}
          </>
        )}
      </p>
      {draft.hook && (
        <p className="text-[11px] text-slate-600 mt-1.5 line-clamp-2 italic">"{draft.hook}"</p>
      )}
      <p className="text-[10px] text-slate-500 mt-1.5 line-clamp-3 leading-relaxed">{draft.script}</p>
      {(() => { const n = JSON.parse(draft.rawContentUrls || "[]").length; return n > 0 ? (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-green-600 font-medium">
          <span>📎</span>
          <span>{n} file{n > 1 ? "s" : ""} uploaded</span>
        </div>
      ) : null; })()}
    </div>
  );
}

// ─── Droppable column ───────────────────────────────────────────────────────
function DroppableColumn({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${className} transition-colors ${isOver ? "bg-indigo-50/60" : ""}`}>
      {children}
    </div>
  );
}

// ─── Stage assignee helpers (used in Kanban + StageManagerModal) ────────────
type PersonValue = "owner" | "client" | `member:${number}` | `creator:${number}`;

function getStageAssignees(s: WorkflowStage): PersonValue[] {
  try { return JSON.parse(s.assignees || "[]"); } catch { return []; }
}

function resolvePersonLabel(v: PersonValue, client: Client | null, team: TeamMember[], creators: Creator[], ownerName: string): { name: string; color: string } | null {
  if (v === "owner") return { name: ownerName, color: "#6366f1" };
  if (v === "client") return { name: client?.name ?? "Client", color: client?.color ?? "#6366f1" };
  if (v.startsWith("member:")) { const m = team.find((m) => m.id === parseInt(v.slice(7))); return m ? { name: m.name, color: m.color } : null; }
  if (v.startsWith("creator:")) { const c = creators.find((c) => c.id === parseInt(v.slice(8))); return c ? { name: c.name, color: c.color } : null; }
  return null;
}

// ─── Main Kanban ────────────────────────────────────────────────────────────
export default function Kanban({ clients, selectedClientId, onSelectClient, activeProfileId, activeProfile, team, ownerName = "Owner", isClient = false, onOpenChat, onBadgesChanged, highlightDraftId, onHighlightConsumed }: Props) {
  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  const [flashId, setFlashId] = useState<number | null>(null);
  const [stages, setStages] = useState<WorkflowStage[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [drafts, setDrafts] = useState<ScriptDraft[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);

  // A client tapped a card on the calendar → scroll to it here and flash it for a moment
  // so they can see where that piece actually lives. (Declared after `drafts` so the dep
  // array doesn't reference it before initialization.)
  useEffect(() => {
    if (!highlightDraftId || !drafts.some((d) => d.id === highlightDraftId)) return;
    const id = highlightDraftId;
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-draft-id="${id}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashId(id);
    }, 120);
    const clear = setTimeout(() => { setFlashId(null); onHighlightConsumed?.(); }, 2600);
    return () => { clearTimeout(t); clearTimeout(clear); };
  }, [highlightDraftId, drafts, onHighlightConsumed]);
  const [activeDraftId, setActiveDraftId] = useState<number | null>(null);
  const [detailDraft, setDetailDraft] = useState<ScriptDraft | null>(null);
  const [rejectDraftData, setRejectDraftData] = useState<ScriptDraft | null>(null);
  const [replaceMode, setReplaceMode] = useState(false);
  const [replacingBusy, setReplacingBusy] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [showRemix, setShowRemix] = useState(false);
  const [goal, setGoal] = useState(7);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalMap, setGoalMap] = useState<Record<number, number>>({});
  const [showImport, setShowImport] = useState(false);
  const [conceptFilter, setConceptFilter] = useState<number | "all">("all");
  const [dayFilter, setDayFilter] = useState<string>("all");
  const [showStageManager, setShowStageManager] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Per-client production goal (how many scripts you want in production for the period).
  useEffect(() => {
    if (!selectedClientId) return;
    try { const v = parseInt(localStorage.getItem(`cf_kanban_goal_${selectedClientId}`) || ""); setGoal(v > 0 ? v : 7); } catch { setGoal(7); }
    try { setGoalMap(JSON.parse(localStorage.getItem(`cf_kanban_goalmap_${selectedClientId}`) || "{}")); } catch { setGoalMap({}); }
  }, [selectedClientId]);
  function saveGoal(n: number) {
    const v = Math.max(1, n || 1);
    setGoal(v);
    try { if (selectedClientId) localStorage.setItem(`cf_kanban_goal_${selectedClientId}`, String(v)); } catch { /* */ }
  }
  function saveGoalConcept(conceptId: number, n: number) {
    const next = { ...goalMap, [conceptId]: Math.max(0, n || 0) };
    if (!next[conceptId]) delete next[conceptId];
    setGoalMap(next);
    try { if (selectedClientId) localStorage.setItem(`cf_kanban_goalmap_${selectedClientId}`, JSON.stringify(next)); } catch { /* */ }
  }

  const reload = useCallback(async () => {
    if (!selectedClientId) return;
    const [s, co, d, cr] = await Promise.all([
      fetch("/api/workflow/ensure-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId }),
      }).then((r) => r.json()),
      fetch(`/api/concepts?clientId=${selectedClientId}&isIdea=false`).then((r) => r.json()),
      fetch(`/api/script-drafts?clientId=${selectedClientId}`).then((r) => r.json()),
      fetch(`/api/creators?clientId=${selectedClientId}`).then((r) => r.json()),
    ]);
    setStages(s);
    setConcepts(co);
    setDrafts(d);
    setCreators(Array.isArray(cr) ? cr : []);
  }, [selectedClientId]);

  useEffect(() => { reload(); }, [reload]);

  // Everyone except the owner sees ONLY the stages assigned to them. A client login
  // sees stages assigned to the "client" role (or to them specifically); a team
  // member sees stages assigned to them. The owner (no activeProfile) sees all.
  const visibleStages = activeProfile
    ? stages.filter((s) => {
        const assignees = getStageAssignees(s);
        return assignees.includes(`member:${activeProfile.id}`) || (activeProfile.isClientAccount && assignees.includes("client"));
      })
    : stages;

  // Posting day(s) per draft, derived from the concept's planned post days (or schedule).
  const conceptPostDays = new Map<number, string | null | undefined>();
  concepts.forEach((c) => conceptPostDays.set(c.id, c.postDays));
  const daysOf = (d: ScriptDraft) => deriveDays(d, conceptPostDays.get(d.conceptId));

  const matchesConcept = (d: ScriptDraft) => conceptFilter === "all" || d.conceptId === conceptFilter;
  const matchesDay = (d: ScriptDraft) => dayFilter === "all" || daysOf(d).includes(dayFilter);
  const matches = (d: ScriptDraft) => matchesConcept(d) && matchesDay(d);
  // Order cards chronologically by their scheduled date; drafts with only a planned
  // weekday come next (grouped Mon → Sun); unscheduled/undated cards sink to the bottom.
  const sortKey = (d: ScriptDraft) => {
    if (d.scheduledDate) { const t = parseSched(d.scheduledDate).getTime(); if (!isNaN(t)) return t; }
    const days = daysOf(d);
    if (days.length) return 8.64e15 + primaryDayOrder(days);
    return 8.65e15;
  };
  const byDay = (a: ScriptDraft, b: ScriptDraft) => sortKey(a) - sortKey(b);

  const pendingDrafts = drafts.filter((d) => d.status === "pending" && !d.stageId && matches(d));
  const savedDrafts   = drafts.filter((d) => d.status === "saved" && matches(d));
  const ideaColumn    = [...pendingDrafts, ...savedDrafts].sort(byDay);

  function draftsForStage(stageId: number) {
    return drafts.filter((d) => d.stageId === stageId && d.status === "accepted" && matches(d)).sort(byDay);
  }

  // Weekdays that actually appear among this client's drafts (for the day filter dropdown).
  const availableDays = DOW.filter((day) => drafts.some((d) => daysOf(d).includes(day)));

  // A sent-back draft this member hasn't opened yet → show a notification on its card.
  const isMemberEditor = !!activeProfile && !activeProfile.isClientAccount;
  const seenSentBack = (isMemberEditor && selectedClientId) ? getSentBackSeen(selectedClientId) : {};
  function isUnseenSentBack(draft: ScriptDraft): boolean {
    return isMemberEditor && !!draft.rejectionFeedback && seenSentBack[draft.id] !== draft.rejectionFeedback;
  }

  // Open a draft in the detail panel. If it was sent back to a member (has feedback),
  // mark it seen so the sidebar "Script Kanban" badge + the card notification clear.
  function openDraft(draft: ScriptDraft) {
    if (draft.rejectionFeedback && selectedClientId) {
      markSentBackSeen(selectedClientId, draft.id, draft.rejectionFeedback);
      onBadgesChanged?.();
    }
    setDetailDraft(draft);
  }

  // ← / → arrow keys step through the cards in the same column while the detail
  // panel is open (so you can review a batch without clicking back and forth).
  // Ignored while typing in a field.
  useEffect(() => {
    if (!detailDraft) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const list = detailDraft!.stageId ? draftsForStage(detailDraft!.stageId) : ideaColumn;
      const idx = list.findIndex((d) => d.id === detailDraft!.id);
      if (idx === -1) return;
      const nextIdx = e.key === "ArrowRight" ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= list.length) return;
      e.preventDefault();
      openDraft(list[nextIdx]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailDraft, drafts, conceptFilter, dayFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the open card scrolled into view inside its column as you navigate.
  useEffect(() => {
    if (!detailDraft) return;
    const el = document.querySelector(`[data-draft-id="${detailDraft.id}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [detailDraft]);

  async function moveDraft(draftId: number, targetStageId: number | null) {
    await fetch(`/api/script-drafts/${draftId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stageId: targetStageId,
        status: targetStageId !== null ? "accepted" : "pending",
        isSavedIdea: false,
      }),
    });
    reload();
  }

  function rejectDraft(draftId: number) {
    const draft = drafts.find((d) => d.id === draftId) || detailDraft;
    if (draft) {
      setReplaceMode(false);
      setRejectDraftData(draft);
      setDetailDraft(null);
    }
  }

  // Replace = same reject question (feedback for AI, or just delete), then generate a fresh
  // script for the SAME concept to take its place.
  function replaceDraft(draftId: number) {
    const draft = drafts.find((d) => d.id === draftId) || detailDraft;
    if (draft) {
      setReplaceMode(true);
      setRejectDraftData(draft);
      setDetailDraft(null);
    }
  }

  async function generateReplacement(draft: ScriptDraft) {
    setReplacingBusy(true);
    try {
      await fetch("/api/script-drafts/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: draft.clientId, conceptIds: [draft.conceptId], count: 1, weekLabel: draft.weekLabel, dayLabel: (draft as any).dayLabel || null }),
      });
    } catch { /* non-fatal */ }
    finally { setReplacingBusy(false); }
  }

  async function confirmReject(draft: ScriptDraft, reasonType: string, reason: string) {
    const reasonLabel = (REJECT_REASONS.find((r) => r.value === reasonType)?.label) || reasonType;
    const feedback = reason.trim() ? `${reasonLabel}: ${reason.trim()}` : reasonLabel;

    if (draft.clientAuthored) {
      // Client wrote this — send the feedback BACK to the client to revise & resubmit,
      // instead of feeding it to the AI example pool. Keep the draft (status "rejected").
      await fetch(`/api/script-drafts/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected", stageId: null, rejectionFeedback: feedback }),
      });
    } else {
      // AI-generated — record the rejection as a learning signal, then delete.
      await fetch("/api/concept-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptId: draft.conceptId,
          clientId: draft.clientId,
          title: draft.title,
          hook: draft.hook || null,
          scriptSnippet: draft.script ? draft.script.slice(0, 150) : null,
          reasonType,
          reason: reason.trim() || null,
        }),
      });
      await fetch(`/api/script-drafts/${draft.id}`, { method: "DELETE" });
    }
    const wasReplace = replaceMode && !draft.clientAuthored;
    setRejectDraftData(null);
    setReplaceMode(false);
    if (wasReplace) { await generateReplacement(draft); }
    reload();
  }

  // Delete a draft outright — no AI learning signal, no feedback to the client.
  async function deleteOnly(draft: ScriptDraft) {
    await fetch(`/api/script-drafts/${draft.id}`, { method: "DELETE" });
    const wasReplace = replaceMode;
    setRejectDraftData(null);
    setReplaceMode(false);
    if (wasReplace) { await generateReplacement(draft); }
    reload();
  }

  async function saveAsIdea(draftId: number, weeksFromNow: number) {
    const resurfaceDate = new Date();
    resurfaceDate.setDate(resurfaceDate.getDate() + weeksFromNow * 7);
    await fetch(`/api/script-drafts/${draftId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "saved",
        isSavedIdea: true,
        resurfaceAt: resurfaceDate.toISOString().slice(0, 10),
        stageId: null,
      }),
    });
    reload();
  }

  function getNextStage(currentStageId: number): WorkflowStage | null {
    const idx = stages.findIndex((s) => s.id === currentStageId);
    if (idx < 0) return null;
    // Skip over any *check* stage that has nobody assigned (Assign Stages) — e.g. an empty
    // Final Check shouldn't block the flow, it just goes straight through to Schedule.
    for (let i = idx + 1; i < stages.length; i++) {
      const s = stages[i];
      const isCheck = /check/i.test(s.name);
      if (isCheck && getStageAssignees(s).length === 0) continue;
      return s;
    }
    return null;
  }

  async function proceedToNextStage(draft: ScriptDraft) {
    if (!draft.stageId) return;
    const next = getNextStage(draft.stageId);
    // Moving forward clears any stale "sent back" note so it doesn't linger.
    await fetch(`/api/script-drafts/${draft.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: next?.id ?? null, status: next ? "accepted" : "accepted", rejectionFeedback: null }),
    });
    reload();
  }

  // Send a draft back to the previous stage with a reason the assignee sees.
  async function sendBackDraft(draft: ScriptDraft, reason: string) {
    if (!draft.stageId) return;
    const idx = stages.findIndex((s) => s.id === draft.stageId);
    const prev = idx > 0 ? stages[idx - 1] : null;
    const fromName = stages[idx]?.name ?? "stage";
    const toName = prev?.name ?? "Ideas";
    // Record the reason as a note (visible to whoever picks it up) + a banner flag.
    await fetch("/api/draft-notes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: draft.id, content: `↩ Sent back (${fromName} → ${toName}): ${reason}`, author: ownerName }),
    }).catch(() => {});
    await fetch(`/api/script-drafts/${draft.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId: prev?.id ?? null, status: prev ? "accepted" : "pending", rejectionFeedback: reason }),
    });
    reload();
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDraftId(parseInt(event.active.id as string));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDraftId(null);
    const { active, over } = event;
    if (!over) return;
    const draftId = parseInt(active.id as string);
    if (over.id === "idea-column") {
      moveDraft(draftId, null);
    } else {
      moveDraft(draftId, parseInt(over.id as string));
    }
  }

  const activeDraft = drafts.find((d) => d.id === activeDraftId) ?? null;

  if (!selectedClientId || !client) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <div className="text-5xl mb-4">📋</div>
        <h2 className="text-xl font-semibold text-slate-700 mb-2">Select a client</h2>
        <p className="text-slate-400 text-sm mb-6">Choose a client from the sidebar to open their kanban board</p>
        <div className="flex flex-wrap gap-3 justify-center">
          {clients.map((c) => (
            <button key={c.id} onClick={() => onSelectClient(c.id)}
              className="flex items-center gap-2.5 px-4 py-2.5 bg-white border border-slate-200 rounded-xl hover:shadow-sm transition-all">
              <div className="w-7 h-7 rounded-lg text-xs font-bold text-white flex items-center justify-center"
                style={{ backgroundColor: c.color }}>
                {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <span className="text-sm font-medium text-slate-700">{c.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl text-sm font-bold text-white flex items-center justify-center"
            style={{ backgroundColor: client.color }}>
            {client.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{client.name}</h1>
            <p className="text-xs text-slate-400">Script Kanban · Week {WEEK_NUMBER}</p>
          </div>
          {/* Production goal — how many scripts you want in production; fills as you drag
              Ideas → Record. Owner only. */}
          {!activeProfile && (() => {
            const produced = drafts.filter((d) => (d as any).stageId != null).length;
            const remaining = Math.max(0, goal - produced);
            const pct = Math.min(100, Math.round((produced / goal) * 100));
            return (
              <div className="relative ml-2">
                <button onClick={() => setGoalOpen((o) => !o)}
                  className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50">
                  <span className="text-sm">🎯</span>
                  <div className="text-left">
                    <p className="text-[11px] font-bold text-slate-700 leading-none">{produced} / {goal} <span className="font-normal text-slate-400">in production</span></p>
                    <div className="w-28 h-1 bg-slate-100 rounded-full mt-1 overflow-hidden">
                      <div className={`h-full rounded-full ${remaining === 0 ? "bg-emerald-500" : "bg-indigo-500"}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className={`text-[11px] font-bold ${remaining > 0 ? "text-amber-600" : "text-emerald-600"}`}>{remaining > 0 ? `${remaining} left` : "✓ done"}</span>
                </button>
                {goalOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setGoalOpen(false)} />
                    <div className="absolute left-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3 space-y-2.5">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Total scripts goal for the period</p>
                      <div className="flex gap-2">
                        {[["7", "1 week"], ["14", "2 weeks"], ["30", "1 month"]].map(([n, lbl]) => (
                          <button key={n} onClick={() => saveGoal(parseInt(n))}
                            className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${goal === parseInt(n) ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                            {n}<span className="block text-[8px] font-normal opacity-80">{lbl}</span>
                          </button>
                        ))}
                        <input type="number" min={1} value={goal} onChange={(e) => saveGoal(parseInt(e.target.value) || 1)}
                          title="Custom total"
                          className="w-14 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                      </div>

                      {/* Per-concept targets */}
                      <div className="pt-1 border-t border-slate-100">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Needed per concept</p>
                        <div className="space-y-1.5 max-h-56 overflow-y-auto">
                          {concepts.length === 0 ? (
                            <p className="text-[10px] text-slate-400">No concepts yet.</p>
                          ) : concepts.map((c) => {
                            const inProd = drafts.filter((d) => d.conceptId === c.id && (d as any).stageId != null).length;
                            const target = goalMap[c.id] || 0;
                            const left = Math.max(0, target - inProd);
                            const label = (c as any).conceptType ? `${(c as any).conceptType} · ${c.name}` : c.name;
                            return (
                              <div key={c.id} className="flex items-center gap-2">
                                <span className="text-[11px] text-slate-600 flex-1 truncate" title={label}>{label}</span>
                                <span className={`text-[10px] font-semibold ${target > 0 ? (left === 0 ? "text-emerald-600" : "text-amber-600") : "text-slate-400"}`}>
                                  {inProd}/{target || "–"}{target > 0 && left > 0 ? ` · ${left} left` : target > 0 && left === 0 ? " ✓" : ""}
                                </span>
                                <input type="number" min={0} value={target || ""} placeholder="0"
                                  onChange={(e) => saveGoalConcept(c.id, parseInt(e.target.value) || 0)}
                                  className="w-12 border border-slate-200 rounded-lg px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                              </div>
                            );
                          })}
                        </div>
                        {Object.values(goalMap).some((v) => v > 0) && (
                          <p className="text-[10px] text-slate-400 mt-1.5">Per-concept targets total {Object.values(goalMap).reduce((s, v) => s + (v || 0), 0)}.</p>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400">Counts cards in Record or further. Drag from Ideas to fill it.</p>
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
          {concepts.length > 0 && (
            <select
              value={conceptFilter}
              onChange={(e) => setConceptFilter(e.target.value === "all" ? "all" : parseInt(e.target.value))}
              className="px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 max-w-[200px]"
            >
              <option value="all">All concepts</option>
              {concepts.map((c) => (
                <option key={c.id} value={c.id}>{(c as any).conceptType ? `${(c as any).conceptType} · ` : ""}{c.name}</option>
              ))}
            </select>
          )}
          {availableDays.length > 0 && (
            <select
              value={dayFilter}
              onChange={(e) => setDayFilter(e.target.value)}
              className="px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="all">All days</option>
              {availableDays.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          )}
          {!activeProfile && (
            <button onClick={() => setShowStageManager(true)}
              className="px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
              ⚙ Assign Stages
            </button>
          )}
          {!activeProfile && (
            <button onClick={() => setShowImport(true)}
              className="px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
              ⬇ Import script
            </button>
          )}
          {!activeProfile && (
            <button onClick={() => setShowRemix(true)}
              className="px-3 py-2 text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 flex items-center gap-1.5">
              ♻️ Remix Winner
            </button>
          )}
          {!activeProfile && (
            <button onClick={() => setShowBatch(true)}
              className="px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 flex items-center gap-1.5">
              📦 Generate Batch
            </button>
          )}
          {!activeProfile && (
            <button onClick={() => setShowGenerate(true)}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 flex items-center gap-1.5">
              ✨ Generate Scripts
            </button>
          )}
        </div>
      </div>

      {/* Board */}
      <DndContext sensors={sensors} collisionDetection={closestCenter}
        onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
          {/* Idea column — hidden for assignees */}
          {!activeProfile && (
            <DroppableColumn id="idea-column"
              className="flex-shrink-0 w-64 bg-white border border-slate-200 rounded-2xl flex flex-col">
              <div className="px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-base">💡</span>
                  <span className="text-sm font-semibold text-slate-700">Ideas</span>
                  {ideaColumn.length > 0 && (
                    <span className="ml-auto text-xs font-semibold bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">
                      {ideaColumn.length}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {ideaColumn.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">
                    No ideas yet.<br />Click ✨ Generate Scripts to start.
                  </p>
                ) : (
                  ideaColumn.map((draft) => (
                    <div key={draft.id}>
                      <DraggableCard draft={draft} days={daysOf(draft)} selected={detailDraft?.id === draft.id} notify={isUnseenSentBack(draft)} highlight={flashId === draft.id} onClick={() => openDraft(draft)} />
                      <div className="flex gap-1.5 mt-1.5">
                        <button onClick={() => moveDraft(draft.id, stages[0]?.id ?? null)}
                          disabled={stages.length === 0}
                          className="flex-1 py-1 text-[10px] font-semibold text-green-600 bg-green-50 rounded-lg hover:bg-green-100 disabled:opacity-40">
                          ✓ Accept
                        </button>
                        <SaveIdeaButton draft={draft} interval={client.generationInterval}
                          onSave={(weeks) => saveAsIdea(draft.id, weeks)} />
                        <button onClick={() => rejectDraft(draft.id)}
                          className="px-2 py-1 text-[10px] font-semibold text-red-500 bg-red-50 rounded-lg hover:bg-red-100">
                          ✗
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </DroppableColumn>
          )}

          {/* Workflow stage columns */}
          {visibleStages.length === 0 && !activeProfile ? (
            <div className="flex-shrink-0 w-56 flex flex-col items-center justify-center text-center py-8 bg-white border border-dashed border-slate-300 rounded-2xl">
              <p className="text-xs text-slate-400 mb-3">No stages set up yet</p>
              <button onClick={() => setShowStageManager(true)}
                className="text-xs text-indigo-600 hover:underline font-medium">
                + Add stages
              </button>
            </div>
          ) : visibleStages.length === 0 && activeProfile ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
              <p className="text-slate-400 text-sm">No stages assigned to you yet.</p>
            </div>
          ) : (
            visibleStages.map((stage) => {
              const stageDrafts = draftsForStage(stage.id);
              const stageIdx = stages.indexOf(stage);
              const nextStage = stageIdx < stages.length - 1 ? stages[stageIdx + 1] : null;
              return (
                <DroppableColumn key={stage.id} id={String(stage.id)}
                  className="flex-shrink-0 w-64 bg-white border border-slate-200 rounded-2xl flex flex-col">
                  <div className="px-4 py-3 border-b border-slate-100"
                    style={{ borderTopWidth: 3, borderTopColor: stage.color }}>
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: stage.color }}>
                        {stageIdx + 1}
                      </span>
                      <span className="text-sm font-semibold text-slate-700 truncate">{stage.name}</span>
                      {stageDrafts.length > 0 && (
                        <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full text-white flex-shrink-0"
                          style={{ backgroundColor: stage.color }}>
                          {stageDrafts.length}
                        </span>
                      )}
                    </div>
                    {(() => {
                      const assignees = getStageAssignees(stage);
                      const people = assignees
                        .map((v) => resolvePersonLabel(v, client, team, creators, ownerName))
                        .filter(Boolean) as { name: string; color: string }[];
                      if (people.length === 0) return null;
                      return (
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          {people.slice(0, 4).map((p, i) => (
                            <div key={i} className="flex items-center gap-1">
                              <div className="w-4 h-4 rounded-full flex-shrink-0 text-[8px] font-bold text-white flex items-center justify-center"
                                style={{ backgroundColor: p.color }}>
                                {p.name[0]}
                              </div>
                              <span className="text-[10px] text-slate-400">{p.name}</span>
                            </div>
                          ))}
                          {people.length > 4 && <span className="text-[10px] text-slate-400">+{people.length - 4}</span>}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[120px]">
                    {stageDrafts.map((draft) => (
                      <div key={draft.id} className="space-y-1.5">
                        <div className="relative group">
                          <DraggableCard draft={draft} days={daysOf(draft)} selected={detailDraft?.id === draft.id} notify={isUnseenSentBack(draft)} highlight={flashId === draft.id} onClick={() => openDraft(draft)} />
                          {/* Quick delete from any stage — plain delete, no AI-context learning. */}
                          {!activeProfile && (
                            <button
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${draft.title}"?\n\nThis permanently removes the reel and can't be undone.`)) deleteOnly(draft); }}
                              title="Delete this reel"
                              className="absolute -top-2 -right-2 z-20 w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm text-slate-400 hover:text-red-600 hover:border-red-300 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                              ✕
                            </button>
                          )}
                        </div>
                        {/* Per-card actions */}
                        {stage.name === "Edit" ? (
                          <div className="space-y-1">
                            <EditedVideoUploadButton draft={draft} onUploaded={(url) => {
                              fetch(`/api/script-drafts/${draft.id}`, {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ editedVideoUrl: url }),
                              }).then(reload);
                            }} />
                            <button
                              onClick={() => proceedToNextStage(draft)}
                              disabled={!draft.editedVideoUrl}
                              title={!draft.editedVideoUrl ? "Upload edited video first" : ""}
                              className="w-full py-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed">
                              → Check 1
                            </button>
                          </div>
                        ) : /check/i.test(stage.name) ? (
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => { const i = stages.findIndex((s) => s.id === draft.stageId); const prev = i > 0 ? stages[i - 1] : null; if (prev) moveDraft(draft.id, prev.id); }}
                              className="flex-1 py-1 text-[10px] font-semibold text-red-500 bg-red-50 rounded-lg hover:bg-red-100">
                              ↩ Send back
                            </button>
                            <button
                              onClick={() => proceedToNextStage(draft)}
                              className="flex-1 py-1 text-[10px] font-semibold text-green-600 bg-green-50 rounded-lg hover:bg-green-100">
                              {nextStage ? `→ ${nextStage.name}` : "✓ Done"}
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-1.5">
                            <FileUploadButton draft={draft} onUploaded={(urls) => {
                              fetch(`/api/script-drafts/${draft.id}`, {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ rawContentUrls: urls }),
                              }).then(reload);
                            }} />
                            <button
                              onClick={() => proceedToNextStage(draft)}
                              className="flex-1 py-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100">
                              {nextStage ? `→ ${nextStage.name}` : "✓ Done"}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </DroppableColumn>
              );
            })
          )}
        </div>

        <DragOverlay>
          {activeDraft && <div className="w-64 opacity-95 shadow-2xl"><CardContent draft={activeDraft} /></div>}
        </DragOverlay>
      </DndContext>

      {/* Detail / refine panel */}
      {detailDraft && (
        <DraftDetailPanel
          key={detailDraft.id}
          draft={detailDraft}
          navList={(detailDraft.stageId ? draftsForStage(detailDraft.stageId) : ideaColumn).map((d) => d.id)}
          language={client.language}
          stages={stages}
          client={client}
          onClose={() => setDetailDraft(null)}
          onAccept={() => { moveDraft(detailDraft.id, stages[0]?.id ?? null); setDetailDraft(null); }}
          onReject={() => rejectDraft(detailDraft.id)}
          onReplace={() => replaceDraft(detailDraft.id)}
          onSaveAsIdea={(weeks) => { saveAsIdea(detailDraft.id, weeks); setDetailDraft(null); }}
          onScriptUpdated={(script, hook) => {
            fetch(`/api/script-drafts/${detailDraft.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ script, hook }),
            }).then(reload);
            setDetailDraft((d) => d ? { ...d, script, hook } : null);
          }}
          activeProfileId={activeProfileId}
          ownerName={ownerName}
          isClient={isClient}
          onProceed={() => { proceedToNextStage(detailDraft); setDetailDraft(null); }}
          onMoveToStage={(sid) => { moveDraft(detailDraft.id, sid); setDetailDraft(null); }}
          onSendBack={(reason) => { sendBackDraft(detailDraft, reason); setDetailDraft(null); }}
          getNextStage={(id) => getNextStage(id)}
          onOpenChat={onOpenChat}
          onUploaded={(urls) => {
            fetch(`/api/script-drafts/${detailDraft.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rawContentUrls: urls }),
            });
            setDetailDraft((d) => d ? { ...d, rawContentUrls: JSON.stringify(urls) } : null);
            setDrafts((ds) => ds.map((d) => d.id === detailDraft.id ? { ...d, rawContentUrls: JSON.stringify(urls) } : d));
          }}
          onEditedVideoUploaded={(url) => {
            fetch(`/api/script-drafts/${detailDraft.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ editedVideoUrl: url }),
            });
            setDetailDraft((d) => d ? { ...d, editedVideoUrl: url } : null);
            setDrafts((ds) => ds.map((d) => d.id === detailDraft.id ? { ...d, editedVideoUrl: url } : d));
          }}
          onExampleUploaded={(url) => {
            fetch(`/api/script-drafts/${detailDraft.id}`, {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ exampleVideoUrl: url }),
            });
            setDetailDraft((d) => d ? { ...d, exampleVideoUrl: url } : null);
            setDrafts((ds) => ds.map((d) => d.id === detailDraft.id ? { ...d, exampleVideoUrl: url } : d));
          }}
          onReviewSubmitted={() => reload()}
          team={team}
          isTextOverlay={(() => {
            const dc = concepts.find((c) => c.id === detailDraft.conceptId);
            if (!dc) return false;
            const vt = (dc.videoType || "").toLowerCase();
            const struct = (dc.structure || "").toLowerCase();
            return (dc as any).textOverlay === true
              || /broll|b-roll|text[\s_-]*overlay|text[\s_-]*hook|on[\s_-]*screen/.test(vt)
              || /op\s*scherm|tekstkaart|text\s*card|on[\s-]*screen|overlay|regel\s*\d/.test(struct);
          })()}
        />
      )}

      {/* Rejection reason modal */}
      {replacingBusy && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium shadow-2xl flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          Generating a replacement script…
        </div>
      )}

      {rejectDraftData && (
        <RejectModal
          draft={rejectDraftData}
          replace={replaceMode}
          onCancel={() => { setReplaceMode(false); setRejectDraftData(null); setDetailDraft(rejectDraftData); }}
          onConfirm={(reasonType, reason) => confirmReject(rejectDraftData, reasonType, reason)}
          onDeleteOnly={() => deleteOnly(rejectDraftData)}
        />
      )}

      {/* Generate modal */}
      {showGenerate && (
        <GenerateModal
          client={client}
          concepts={concepts}
          onClose={() => setShowGenerate(false)}
          onGenerated={() => { setShowGenerate(false); reload(); }}
        />
      )}

      {/* Batch generate modal */}
      {showBatch && (
        <BatchModal
          client={client}
          concepts={concepts}
          drafts={drafts}
          onClose={() => setShowBatch(false)}
          onGenerated={() => { setShowBatch(false); reload(); }}
        />
      )}

      {/* Remix-a-winner modal */}
      {showRemix && (
        <RemixModal
          client={client}
          concepts={concepts}
          onClose={() => setShowRemix(false)}
          onGenerated={() => { setShowRemix(false); reload(); }}
        />
      )}

      {/* Import modal */}
      {showImport && (
        <ImportScriptModal
          client={client}
          concepts={concepts}
          stages={stages}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); reload(); }}
        />
      )}

      {/* Stage manager */}
      {showStageManager && (
        <StageManagerModal
          client={client}
          stages={stages}
          team={team}
          creators={creators}
          ownerName={ownerName}
          onClose={() => setShowStageManager(false)}
          onSaved={() => { setShowStageManager(false); reload(); }}
        />
      )}
    </div>
  );
}

// ─── Cloudinary upload helper ────────────────────────────────────────────────
// Single-request uploads are capped (~100MB) and big videos fail with a CORS-looking
// error. So we chunk anything large via Cloudinary's chunked-upload protocol.
const UPLOAD_CHUNK = 20 * 1024 * 1024; // 20MB

// Videos bigger than Cloudinary's ~100MB cap go to Vercel Blob (no size limit).
const CLOUDINARY_MAX = 95 * 1024 * 1024;
// PUT one part to its presigned URL, retrying on transient failures. Sends raw bytes with
// NO Content-Type header (the presigned UploadPart signs host only). Doesn't read any
// response header, so it needs no bucket ExposeHeaders config.
function putPartWithRetry(url: string, blob: Blob, onLoaded: (loaded: number) => void): Promise<void> {
  const MAX = 4;
  const attempt = () => new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = 5 * 60_000;
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) onLoaded(ev.loaded); };
    xhr.onload = () => { (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`server ${xhr.status}`)); };
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.send(blob);
  });
  return (async () => {
    for (let i = 1; i <= MAX; i++) {
      try { await attempt(); return; }
      catch (e) { if (i === MAX) throw e; await new Promise((r) => setTimeout(r, 1000 * i)); }
    }
  })();
}

async function blobUpload(file: File, onProgress: (pct: number) => void): Promise<string> {
  // Large videos (>95MB) go to Cloudflare R2 as MULTIPART: ~8MB parts uploaded + retried
  // independently. A single multi-hundred-MB PUT gets killed by some AV/firewall/flaky
  // uplinks; small parts sail through, and a blip costs one retried chunk, not the job.
  const PART = 8 * 1024 * 1024;
  const total = file.size;
  const partCount = Math.max(1, Math.ceil(total / PART));

  const mp = async (payload: object) =>
    fetch("/api/r2/multipart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then((r) => r.json());

  const create = await mp({ action: "create", filename: file.name, contentType: file.type || "video/mp4" });
  if (!create?.uploadId || !create?.key || !create?.publicUrl) {
    throw new Error("Big-video upload failed (could not start): " + (create?.error || "storage not configured"));
  }
  const { uploadId, key, publicUrl } = create;

  const parts: { PartNumber: number; ETag: string }[] = [];
  let uploadedBytes = 0;
  try {
    for (let i = 0; i < partCount; i++) {
      const start = i * PART;
      const end = Math.min(start + PART, total);
      const blob = file.slice(start, end);
      // ETag for an unencrypted part is the MD5 of its bytes — compute it here so we don't
      // need to read R2's response header (avoids any CORS ExposeHeaders requirement).
      const buf = await blob.arrayBuffer();
      const etag = '"' + SparkMD5.ArrayBuffer.hash(buf) + '"';
      const signed = await mp({ action: "sign", key, uploadId, partNumber: i + 1 });
      if (!signed?.url) throw new Error("could not sign part " + (i + 1));
      await putPartWithRetry(signed.url, blob, (loaded) => onProgress(Math.min(99, Math.round(((uploadedBytes + loaded) / total) * 100))));
      uploadedBytes += end - start;
      onProgress(Math.min(99, Math.round((uploadedBytes / total) * 100)));
      parts.push({ PartNumber: i + 1, ETag: etag });
    }
    const done = await mp({ action: "complete", key, uploadId, parts });
    if (!done?.publicUrl) throw new Error(done?.error || "could not finalize upload");
    onProgress(100);
    return done.publicUrl || publicUrl;
  } catch (e) {
    mp({ action: "abort", key, uploadId }).catch(() => {}); // best-effort cleanup
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Upload failed (${reason}). The file uploads in pieces and auto-retries each — if it keeps failing, the network/security software is blocking storage; try a different network.`);
  }
}

// Everything uploads to Cloudflare R2 now (Cloudinary is gone — its free tier kept getting
// disabled and capped videos at ~95MB). blobUpload handles ANY size via multipart: small
// files are a single part, big videos chunk + retry. No size cap, no credit limit.
function cloudinaryUpload(file: File, onProgress: (pct: number) => void): Promise<string> {
  return blobUpload(file, onProgress);
}

// ─── File upload button ─────────────────────────────────────────────────────
function FileUploadButton({ draft, onUploaded }: { draft: ScriptDraft; onUploaded: (urls: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const existing: string[] = JSON.parse(draft.rawContentUrls || "[]");

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setProgress(0);
    setError("");
    try {
      const urls: string[] = [];
      for (const f of files) {
        const url = await cloudinaryUpload(f, (pct) => setProgress(pct));
        urls.push(url);
      }
      onUploaded([...existing, ...urls]);
    } catch (err) {
      setError(String(err));
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="video/*,image/*" multiple className="hidden" onChange={handleFiles} />
      {error && <p className="text-[9px] text-red-500 truncate">{error}</p>}
      <button
        onClick={() => inputRef.current?.click()}
        disabled={progress !== null}
        title="Upload raw content"
        className={`px-2 py-1 text-[10px] font-semibold rounded-lg transition-colors ${
          existing.length > 0
            ? "text-green-600 bg-green-50 hover:bg-green-100"
            : "text-slate-500 bg-slate-100 hover:bg-slate-200"
        }`}>
        {progress !== null ? `${progress}%` : existing.length > 0 ? `📎 ${existing.length}` : "⬆ Upload"}
      </button>
    </>
  );
}

// ─── Copyable link + QR for the finished video (open it on your phone) ────────
function VideoShareLink({ url, draftId }: { url: string; draftId?: number }) {
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  // Review link: a phone page where someone watches the video and can approve it to the
  // next stage (or send it back) without logging in.
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [reviewCopied, setReviewCopied] = useState(false);
  const [reviewQR, setReviewQR] = useState(false);
  const [minting, setMinting] = useState(false);

  async function getReviewUrl(): Promise<string | null> {
    if (reviewUrl) return reviewUrl;
    if (!draftId) return null;
    setMinting(true);
    try {
      const d = await fetch("/api/upload-tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId }) }).then((r) => r.json());
      if (!d?.token) return null;
      const u = `${window.location.origin}/review/${d.token}`;
      setReviewUrl(u);
      return u;
    } catch { return null; } finally { setMinting(false); }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-[11px] text-slate-500 truncate" />
        <button
          onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }}
          className="px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 whitespace-nowrap">
          {copied ? "✓" : "🔗 Video"}
        </button>
        <button onClick={() => setShowQR((s) => !s)}
          className="px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 whitespace-nowrap">📱</button>
      </div>
      {showQR && (
        <div className="flex flex-col items-center gap-1 bg-white border border-slate-200 rounded-xl p-3">
          <QRCodeSVG value={url} size={140} />
          <p className="text-[10px] text-slate-400">Scan to open the raw video</p>
        </div>
      )}

      {draftId && (
        <div className="flex items-center gap-2">
          <button
            onClick={async () => { const u = await getReviewUrl(); if (u) { try { await navigator.clipboard.writeText(u); setReviewCopied(true); setTimeout(() => setReviewCopied(false), 1500); } catch { /* ignore */ } } }}
            disabled={minting}
            className="flex-1 px-2.5 py-1.5 text-[11px] font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 whitespace-nowrap disabled:opacity-50">
            {minting ? "…" : reviewCopied ? "✓ Review link copied" : "✅ Copy review link (approve from phone)"}
          </button>
          <button onClick={async () => { await getReviewUrl(); setReviewQR((s) => !s); }}
            className="px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 whitespace-nowrap">📱</button>
        </div>
      )}
      {reviewQR && reviewUrl && (
        <div className="flex flex-col items-center gap-1 bg-white border border-slate-200 rounded-xl p-3">
          <QRCodeSVG value={reviewUrl} size={140} />
          <p className="text-[10px] text-slate-400">Scan to review + approve on your phone</p>
        </div>
      )}
    </div>
  );
}

// ─── Edited video upload button ─────────────────────────────────────────────
function EditedVideoUploadButton({ draft, onUploaded }: { draft: ScriptDraft; onUploaded: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const hasVideo = !!draft.editedVideoUrl;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProgress(0);
    setError("");
    try {
      const url = await cloudinaryUpload(file, (pct) => setProgress(pct));
      onUploaded(url);
    } catch (err) {
      setError(String(err));
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-1">
      {error && <p className="text-[9px] text-red-500">{error}</p>}
      <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={handleFile} />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={progress !== null}
        className={`w-full py-1.5 text-[10px] font-semibold rounded-lg transition-colors flex items-center justify-center gap-1 ${
          hasVideo
            ? "text-green-700 bg-green-100 hover:bg-green-200"
            : "text-orange-600 bg-orange-50 hover:bg-orange-100"
        }`}>
        {progress !== null ? `Uploading ${progress}%` : hasVideo ? "✓ Edited video uploaded · Replace" : "⬆ Upload Edited Video"}
      </button>
    </div>
  );
}

// ─── Example/reference video the recorder copies ──────────────────────────────
function ExampleVideoSection({ draft, onUploaded }: { draft: ScriptDraft; onUploaded: (url: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProgress(0);
    try { onUploaded(await cloudinaryUpload(file, (pct) => setProgress(pct))); }
    catch { /* ignore */ }
    finally { setProgress(null); if (inputRef.current) inputRef.current.value = ""; }
  }
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">🎬 Example to copy</label>
      {draft.exampleVideoUrl ? (
        <div className="rounded-xl overflow-hidden bg-slate-900 aspect-video mb-1.5">
          <video src={draft.exampleVideoUrl} controls className="w-full h-full object-contain" />
        </div>
      ) : (
        <p className="text-xs text-slate-400 italic mb-1.5">No example yet — add a reference recording for whoever films this.</p>
      )}
      <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={handleFile} />
      <div className="flex items-center gap-2">
        <button onClick={() => inputRef.current?.click()} disabled={progress !== null}
          className="text-[11px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-lg">
          {progress !== null ? `Uploading ${progress}%…` : draft.exampleVideoUrl ? "Replace example" : "⬆ Upload example"}
        </button>
        {draft.exampleVideoUrl && (
          <button onClick={() => onUploaded(null)} className="text-[11px] text-slate-400 hover:text-red-500">Remove</button>
        )}
      </div>
    </div>
  );
}

// ─── Save-as-Idea button ────────────────────────────────────────────────────
function SaveIdeaButton({ draft, interval, onSave }: { draft: ScriptDraft; interval: number; onSave: (weeks: number) => void }) {
  const [open, setOpen] = useState(false);
  const [weeks, setWeeks] = useState(interval);
  if (draft.isSavedIdea) return null;
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Save as idea for later"
        className="px-2 py-1 text-[10px] font-semibold text-amber-600 bg-amber-50 rounded-lg hover:bg-amber-100">
        💡
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold text-slate-800 mb-1">💡 Save as idea</p>
            <p className="text-xs text-slate-500 mb-4 line-clamp-1">{draft.title}</p>
            <label className="text-xs font-semibold text-slate-600">Resurface in how many weeks?</label>
            <div className="flex items-center gap-2 mt-2 mb-4">
              <input type="number" min={1} max={52} value={weeks} autoFocus
                onChange={(e) => setWeeks(parseInt(e.target.value) || 1)}
                className="w-20 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <span className="text-xs text-slate-500">weeks</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)}
                className="flex-1 py-2 text-xs font-medium text-slate-500 bg-slate-100 rounded-lg hover:bg-slate-200">Cancel</button>
              <button onClick={() => { onSave(weeks); setOpen(false); }}
                className="flex-1 py-2 text-xs font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600">Save idea</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Detail / Refine panel ──────────────────────────────────────────────────
function DraftDetailPanel({
  draft, navList, language, stages, team, client: clientData, onClose, onAccept, onReject, onReplace, onSaveAsIdea, onScriptUpdated, onProceed, onMoveToStage, onSendBack, getNextStage, onUploaded, onEditedVideoUploaded, onExampleUploaded, onReviewSubmitted, activeProfileId, ownerName = "Owner", isClient = false, onOpenChat, isTextOverlay = false,
}: {
  draft: ScriptDraft; language: string; stages: WorkflowStage[]; team: TeamMember[]; client?: { name: string; color: string } | null;
  navList?: number[];
  isTextOverlay?: boolean;
  onClose: () => void; onAccept: () => void; onReject: () => void; onReplace?: () => void;
  onSaveAsIdea: (weeks: number) => void;
  onScriptUpdated: (script: string, hook: string | null) => void;
  onProceed: () => void;
  onMoveToStage?: (stageId: number | null) => void;
  onSendBack?: (reason: string) => void;
  getNextStage: (stageId: number) => WorkflowStage | null;
  onUploaded: (urls: string[]) => void;
  onEditedVideoUploaded: (url: string | null) => void;
  onExampleUploaded: (url: string | null) => void;
  onReviewSubmitted: () => void;
  activeProfileId: number | null;
  ownerName?: string;
  isClient?: boolean;
  onOpenChat?: (context: { id?: number; title: string; hook?: string | null; script: string; caption?: string | null; channel?: string }) => void;
}) {
  const [script, setScript] = useState(draft.script);
  const [hook, setHook] = useState(draft.hook || "");
  const [showChatPicker, setShowChatPicker] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [refining, setRefining] = useState(false);
  const [saveWeeks, setSaveWeeks] = useState(2);
  const [checkApproved, setCheckApproved] = useState(false);
  const [notes, setNotes] = useState<{ id: number; author: string; content: string; createdAt: string; imageUrl?: string | null }[]>([]);
  const [noteImg, setNoteImg] = useState<string | null>(null);
  const [noteImgUploading, setNoteImgUploading] = useState(false);
  const noteImgRef = useRef<HTMLInputElement>(null);
  const [changes, setChanges] = useState<{ id: number; field: string; before: string; after: string; author: string; createdAt: string }[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [showSendBack, setShowSendBack] = useState(false);
  const [sendBackReason, setSendBackReason] = useState("");
  const [prevHook, setPrevHook] = useState(draft.hook || "");
  const [prevScript, setPrevScript] = useState(draft.script);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const inStage = !!draft.stageId;
  const nextStage = draft.stageId ? getNextStage(draft.stageId) : null;

  // Alternative hooks generated by Remix Winner — pick one and it swaps into the script's
  // opening line (so the chosen hook rides along when this moves to Record).
  const hookOptions: string[] = (() => {
    try { return JSON.parse((draft as any).hookAlternatives || "[]"); } catch { return []; }
  })();
  function selectHook(alt: string) {
    const lines = script.split("\n");
    const firstIdx = lines.findIndex((l) => l.trim());
    let newScript = script;
    if (firstIdx >= 0 && (isTextOverlay || lines[firstIdx].trim() === (hook || "").trim())) {
      lines[firstIdx] = alt;
      newScript = lines.join("\n");
    } else if (hook && script.includes(hook)) {
      newScript = script.replace(hook, alt);
    }
    setScript(newScript);
    setHook(alt);
    onScriptUpdated(newScript, alt);
  }
  // Author notes under the real person's name (member's name, or the owner).
  const authorName = activeProfileId ? (team.find((m) => m.id === activeProfileId)?.name || "Team") : ownerName;

  async function addNote() {
    const content = noteInput.trim();
    if (!content && !noteImg) return;
    const n = await fetch("/api/draft-notes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: draft.id, content, author: authorName, imageUrl: noteImg }),
    }).then((r) => r.json());
    setNotes((prev) => [...prev, n]);
    setNoteInput("");
    setNoteImg(null);
  }

  async function uploadNoteImage(file?: File | null) {
    if (!file || !file.type.startsWith("image")) return;
    setNoteImgUploading(true);
    try { const url = await cloudinaryUpload(file, () => {}); setNoteImg(url); }
    catch (e) { alert("Image upload failed: " + (e instanceof Error ? e.message : String(e))); }
    finally { setNoteImgUploading(false); }
  }

  useEffect(() => {
    const loadNotes = () => fetch(`/api/draft-notes?draftId=${draft.id}`).then(r => r.json()).then(setNotes).catch(() => {});
    loadNotes();
    fetch(`/api/draft-changes?draftId=${draft.id}`).then(r => r.json()).then(setChanges).catch(() => {});
    // Refresh notes periodically so a teammate's note appears without reopening.
    const i = setInterval(loadNotes, 12000);
    return () => clearInterval(i);
  }, [draft.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function refine() {
    if (!chatInput.trim()) return;
    const newMessages = [...messages, { role: "user" as const, content: chatInput }];
    setMessages(newMessages);
    setChatInput("");
    setRefining(true);
    try {
      const res = await fetch("/api/script-drafts/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originalScript: script, hook, messages: newMessages, language }),
      });
      const data = await res.json();
      const revised = data.script || script;
      setScript(revised);
      setMessages((m) => [...m, { role: "assistant", content: `✓ Updated:\n\n${revised}` }]);
      onScriptUpdated(revised, hook || null);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Failed to refine. Try again." }]);
    } finally {
      setRefining(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[680px] max-w-[92vw] bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between flex-shrink-0">
          <div>
            <p className="text-xs font-semibold text-indigo-500 mb-0.5">{draft.concept ? ((draft.concept as any).conceptType ? `${(draft.concept as any).conceptType} · ${draft.concept.name}` : draft.concept.name) : ""}</p>
            <h3 className="text-sm font-bold text-slate-800">{draft.title}</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">{draft.weekLabel}{draft.dayLabel ? ` · ${draft.dayLabel}` : ""}</p>
          </div>
          <div className="flex items-center gap-3 ml-4">
            {navList && navList.length > 1 && navList.indexOf(draft.id) !== -1 && (
              <span className="text-[10px] text-slate-400 whitespace-nowrap" title="Use ← → arrow keys to move between cards">
                {navList.indexOf(draft.id) + 1} / {navList.length} · ◄ ►
              </span>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {draft.rejectionFeedback && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-1">↩ {inStage ? "Sent back — needs changes" : "Feedback from whoever sent this back"}</p>
              <p className="text-sm text-amber-800">{draft.rejectionFeedback}</p>
            </div>
          )}
          {hookOptions.length > 1 && (
            <div className="rounded-xl border border-purple-200 bg-purple-50/60 px-4 py-3">
              <p className="text-[10px] font-semibold text-purple-600 uppercase tracking-wide mb-2">♻️ Hook options — pick the one to record</p>
              <div className="space-y-1.5">
                {hookOptions.map((h, i) => {
                  const active = (hook || "").trim() === h.trim();
                  return (
                    <button key={i} onClick={() => selectHook(h)}
                      className={`w-full text-left text-xs px-3 py-2 rounded-lg border transition-all flex items-start gap-2 ${
                        active ? "bg-white border-purple-400 ring-1 ring-purple-300 text-slate-800" : "bg-white/70 border-slate-200 text-slate-600 hover:border-purple-300"
                      }`}>
                      <span className={`mt-0.5 w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center text-[8px] ${active ? "bg-purple-600 text-white" : "border border-slate-300"}`}>
                        {active && "✓"}
                      </span>
                      <span>{h}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {isTextOverlay ? (
            /* Text-hook + B-roll format: no spoken script — just the on-screen text. */
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Text Hook · on-screen text</label>
              <textarea rows={8} value={script}
                onChange={(e) => {
                  const v = e.target.value;
                  const firstLine = v.split("\n").map((l) => l.trim()).find(Boolean) || "";
                  setScript(v); setHook(firstLine);
                  onScriptUpdated(v, firstLine || null);
                }}
                onBlur={(e) => {
                  if (inStage && e.target.value !== prevScript) {
                    fetch("/api/draft-changes", { method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ draftId: draft.id, field: "script", before: prevScript, after: e.target.value, author: authorName }) })
                      .then(r => r.json()).then(c => { if (c) setChanges(prev => [...prev, c]); });
                    setPrevScript(e.target.value);
                  }
                }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              <p className="text-[10px] text-slate-400 mt-1">on-screen text cards · {script.split(" ").filter(Boolean).length} words</p>
            </div>
          ) : (
            <>
              {/* Hook */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Text Hook</label>
                <input value={hook}
                  onChange={(e) => { setHook(e.target.value); onScriptUpdated(script, e.target.value); }}
                  onBlur={(e) => {
                    if (inStage && e.target.value !== prevHook) {
                      fetch("/api/draft-changes", { method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ draftId: draft.id, field: "hook", before: prevHook, after: e.target.value, author: authorName }) })
                        .then(r => r.json()).then(c => { if (c) setChanges(prev => [...prev, c]); });
                      setPrevHook(e.target.value);
                    }
                  }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>

              {/* Script */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Script</label>
                <textarea rows={8} value={script}
                  onChange={(e) => { setScript(e.target.value); onScriptUpdated(e.target.value, hook || null); }}
                  onBlur={(e) => {
                    if (inStage && e.target.value !== prevScript) {
                      fetch("/api/draft-changes", { method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ draftId: draft.id, field: "script", before: prevScript, after: e.target.value, author: authorName }) })
                        .then(r => r.json()).then(c => { if (c) setChanges(prev => [...prev, c]); });
                      setPrevScript(e.target.value);
                    }
                  }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
                <p className="text-[10px] text-slate-400 mt-1">{script.split(" ").filter(Boolean).length} words</p>
              </div>
            </>
          )}

          {/* Schedule to calendar — owner only */}
          {inStage && !isClient && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Schedule to Calendar</label>
              <input
                type="date"
                defaultValue={draft.scheduledDate ?? ""}
                onChange={(e) => {
                  fetch(`/api/script-drafts/${draft.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ scheduledDate: e.target.value || null }),
                  });
                }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {draft.scheduledDate && (
                <p className="text-[10px] text-indigo-500 mt-1">📅 Scheduled for {draft.scheduledDate} — visible on Content Scheduling</p>
              )}
            </div>
          )}

          {(() => {
            const stageName = stages.find((s) => s.id === draft.stageId)?.name || "";
            const isCheckStage = /check/i.test(stageName);   // "Check 1", "Final Check", …
            const isEditStage = stageName === "Edit";
            // Everything after Edit (checks, schedule, done) = view the finished cut, hide raw.
            const stageIdx = stages.findIndex((s) => s.id === draft.stageId);
            const editIdx = stages.findIndex((s) => s.name === "Edit");
            const afterEdit = editIdx >= 0 && stageIdx > editIdx;
            return (
              <>
                {/* Example to copy — reference recording. Shown whenever one is attached
                    (including Ideas, e.g. a competitor reel sent here), and during
                    record/edit so an example can be uploaded. */}
                {(!!draft.exampleVideoUrl || (inStage && !isCheckStage && !afterEdit)) && (
                  <ExampleVideoSection draft={draft} onUploaded={onExampleUploaded} />
                )}

                {/* Raw content — only while recording/editing (hidden once the cut is done) */}
                {inStage && !isCheckStage && !afterEdit && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Raw Content</label>
                    <RawContentUpload draft={draft} onUploaded={onUploaded} />
                  </div>
                )}

                {/* Finished video — uploaded on Edit, viewed on every stage after Edit (checks, Schedule, …) */}
                {inStage && (isEditStage || afterEdit) && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Finished Video</label>
                    {isEditStage ? (
                      <FinishedVideoUpload draft={draft} onUploaded={onEditedVideoUploaded} />
                    ) : draft.editedVideoUrl ? (
                      <div className="rounded-xl overflow-hidden bg-slate-900 aspect-video">
                        <video src={draft.editedVideoUrl} controls className="w-full h-full object-contain" />
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic">No finished video uploaded yet.</p>
                    )}
                    {draft.editedVideoUrl && <VideoShareLink url={draft.editedVideoUrl} draftId={draft.id} />}
                  </div>
                )}

              </>
            );
          })()}

          {/* Chat refine — only in Ideas stage */}
          {!inStage && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Refine with Claude
              </label>
              {messages.length > 0 && (
                <div className="mb-3 space-y-2 max-h-48 overflow-y-auto">
                  {messages.map((m, i) => (
                    <div key={i} className={`text-xs px-3 py-2 rounded-lg ${
                      m.role === "user"
                        ? "bg-indigo-50 text-indigo-800 ml-6"
                        : "bg-slate-50 text-slate-700 mr-6"
                    }`}>
                      <pre className="whitespace-pre-wrap font-sans">{m.content}</pre>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); refine(); } }}
                  placeholder="Make the hook funnier, shorter, more Dutch…"
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button onClick={refine} disabled={refining || !chatInput.trim()}
                  className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {refining ? "…" : "Send"}
                </button>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Notes</label>
            <div className="space-y-2 mb-2">
              {notes.length === 0 && <p className="text-xs text-slate-400">No notes yet.</p>}
              {notes.map((n) => (
                <div key={n.id} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  {n.content && <p className="text-xs text-slate-700 whitespace-pre-wrap">{n.content}</p>}
                  {n.imageUrl && (
                    <a href={n.imageUrl} target="_blank" rel="noopener noreferrer" className={n.content ? "block mt-1.5" : "block"}>
                      <img src={n.imageUrl} alt="note attachment" className="rounded-lg max-h-48 border border-amber-200" />
                    </a>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">{n.author} · {new Date(n.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              ))}
            </div>

            {/* Pending screenshot preview */}
            {(noteImg || noteImgUploading) && (
              <div className="mb-2 flex items-center gap-2">
                {noteImgUploading ? (
                  <span className="text-xs text-slate-400">Uploading image…</span>
                ) : (
                  <div className="relative inline-block">
                    <img src={noteImg!} alt="" className="h-16 rounded-lg border border-slate-200" />
                    <button onClick={() => setNoteImg(null)}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-black/60 text-white text-[9px] flex items-center justify-center">✕</button>
                  </div>
                )}
              </div>
            )}

            <input ref={noteImgRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { uploadNoteImage(e.target.files?.[0]); if (e.target) e.target.value = ""; }} />
            <div className="flex gap-2">
              <input value={noteInput} onChange={(e) => setNoteInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNote(); } }}
                onPaste={(e) => {
                  const img = Array.from(e.clipboardData.items).find((it) => it.type.startsWith("image"));
                  if (img) { const f = img.getAsFile(); if (f) { e.preventDefault(); uploadNoteImage(f); } }
                }}
                placeholder="Add a note… (paste a screenshot too)"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <button onClick={() => noteImgRef.current?.click()} title="Attach screenshot"
                className="px-3 py-2 text-sm bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200">📎</button>
              <button onClick={addNote} disabled={noteImgUploading}
                className="px-3 py-2 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50">Add</button>
            </div>
          </div>

          {/* Change history */}
          {inStage && changes.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Change History</label>
              <div className="space-y-2">
                {changes.map((c) => {
                  // Find exact changed region only — no surrounding context
                  let i = 0;
                  while (i < c.before.length && i < c.after.length && c.before[i] === c.after[i]) i++;
                  let j = 0;
                  while (j < c.before.length - i && j < c.after.length - i && c.before[c.before.length - 1 - j] === c.after[c.after.length - 1 - j]) j++;
                  const beforeSnip = c.before.slice(i, j > 0 ? -j : undefined).trim();
                  const afterSnip = c.after.slice(i, j > 0 ? -j : undefined).trim();
                  return (
                    <div key={c.id} className="border border-slate-200 rounded-lg overflow-hidden text-xs">
                      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-200">
                        <span className="font-semibold text-slate-600 capitalize">{c.field} edited</span>
                        <span className="text-slate-400">{c.author} · {new Date(c.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-slate-200">
                        <div className="px-3 py-2 bg-red-50">
                          <p className="text-[10px] font-semibold text-red-400 mb-1">Removed</p>
                          <p className="text-slate-600 whitespace-pre-wrap">{beforeSnip || "—"}</p>
                        </div>
                        <div className="px-3 py-2 bg-green-50">
                          <p className="text-[10px] font-semibold text-green-500 mb-1">Added</p>
                          <p className="text-slate-600 whitespace-pre-wrap">{afterSnip || "—"}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-slate-100 flex-shrink-0 space-y-2">
          {onOpenChat && (
            <div className="relative">
              <button
                onClick={() => setShowChatPicker((s) => !s)}
                className="w-full py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
              >
                💬 Talk about this reel
              </button>
              {showChatPicker && (
                <div className="absolute bottom-full mb-2 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-100">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Talk to...</p>
                  </div>
                  {(() => {
                    const ctx = { id: draft.id, title: draft.title, hook: draft.hook, script: draft.script, caption: draft.caption };
                    // A logged-in member (editor/client) can only talk to the owner — their
                    // own conversation thread. The owner can talk to the client + each member.
                    if (isClient) {
                      const viewer = team.find((m) => m.id === activeProfileId);
                      const channel = viewer?.isClientAccount ? "client" : `member:${activeProfileId}`;
                      return (
                        <button
                          onClick={() => { setShowChatPicker(false); onOpenChat({ ...ctx, channel }); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 text-left"
                        >
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ backgroundColor: "#6366f1" }}>
                            {ownerName[0]?.toUpperCase()}
                          </div>
                          <div>
                            <span className="text-sm text-slate-700">{ownerName}</span>
                            <span className="text-[10px] text-slate-400 ml-1.5">owner</span>
                          </div>
                        </button>
                      );
                    }
                    return (
                      <>
                        {/* Client option */}
                        <button
                          onClick={() => { setShowChatPicker(false); onOpenChat({ ...ctx, channel: "client" }); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 text-left"
                        >
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ backgroundColor: clientData?.color ?? "#6366f1" }}>
                            {clientData ? clientData.name.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase() : "C"}
                          </div>
                          <div>
                            <span className="text-sm text-slate-700">{clientData?.name ?? "Client"}</span>
                            <span className="text-[10px] text-slate-400 ml-1.5">client</span>
                          </div>
                        </button>
                        {/* Team members */}
                        {team.filter((m) => !m.isClientAccount).map((m) => (
                          <button
                            key={m.id}
                            onClick={() => { setShowChatPicker(false); onOpenChat({ ...ctx, channel: `member:${m.id}` }); }}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 text-left"
                          >
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ backgroundColor: m.color }}>
                              {m.name[0]?.toUpperCase()}
                            </div>
                            <span className="text-sm text-slate-700">{m.name}{m.role ? ` · ${m.role}` : ""}</span>
                          </button>
                        ))}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
          {/* Jump straight to any stage — skip steps you don't need (e.g. no filming needed) */}
          {onMoveToStage && !isClient && stages.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 whitespace-nowrap">⤳ Jump to stage</span>
              <select
                value={draft.stageId ?? ""}
                onChange={(e) => { const v = e.target.value; onMoveToStage(v === "" ? null : parseInt(v)); }}
                className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                <option value="">💡 Ideas (not started)</option>
                {stages.map((s, i) => (
                  <option key={s.id} value={s.id}>{i + 1}. {s.name}</option>
                ))}
              </select>
            </div>
          )}
          {/* Send back with a reason. Owner/editor → previous stage. A creator at the
              first stage → back to the owner (Ideas) with feedback. */}
          {inStage && onSendBack && (() => {
            const idx = stages.findIndex((s) => s.id === draft.stageId);
            const prevName = idx > 0 ? stages[idx - 1]?.name : (isClient ? ownerName : "Ideas");
            return showSendBack ? (
              <div className="space-y-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-[11px] font-semibold text-amber-700">↩ {isClient && idx === 0 ? `Send back to ${ownerName}` : `Send back to ${prevName}`} — why? (your feedback)</p>
                <textarea value={sendBackReason} onChange={(e) => setSendBackReason(e.target.value)} rows={3} autoFocus
                  placeholder={isClient ? "e.g. I don't want to record this — hook feels off, doesn't fit me…" : "e.g. re-cut the hook, audio is low, wrong clip at 0:08…"}
                  className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none" />
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setShowSendBack(false); setSendBackReason(""); }} className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 rounded-lg">Cancel</button>
                  <button onClick={() => { if (sendBackReason.trim()) { onSendBack(sendBackReason.trim()); setShowSendBack(false); setSendBackReason(""); } }}
                    disabled={!sendBackReason.trim()}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50">↩ Send back</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowSendBack(true)}
                className="w-full py-2 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100">
                {isClient ? `↩ Send back to ${ownerName} (with feedback)` : "↩ Send back a stage (with a note)"}
              </button>
            );
          })()}
          {inStage ? (
              // Whoever is assigned to this stage (via Assign Stages) just reviews and either
              // sends it back or pushes it through — no separate approval collection gates it.
              <button onClick={onProceed}
                className="w-full py-2.5 text-sm font-semibold text-white rounded-xl transition-colors bg-indigo-600 hover:bg-indigo-700">
                {nextStage ? `→ Proceed to ${nextStage.name}` : "✓ Mark as Done"}
              </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={onAccept}
                className="flex-1 py-2 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600">
                ✓ Accept
              </button>
              {onReplace && !draft.clientAuthored && (
                <button onClick={onReplace}
                  className="px-4 py-2 text-sm font-semibold text-indigo-600 bg-indigo-50 rounded-xl hover:bg-indigo-100">
                  🔄 Replace
                </button>
              )}
              <button onClick={onReject}
                className="px-4 py-2 text-sm font-semibold text-red-500 bg-red-50 rounded-xl hover:bg-red-100">
                ✗ Reject
              </button>
            </div>
          )}
          {!inStage && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">💡 Save idea, resurface in</span>
              <input type="number" min={1} max={52} value={saveWeeks}
                onChange={(e) => setSaveWeeks(parseInt(e.target.value) || 1)}
                className="w-14 border border-slate-200 rounded-lg px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-amber-400" />
              <span className="text-xs text-slate-500">weeks</span>
              <button onClick={() => onSaveAsIdea(saveWeeks)}
                className="ml-auto px-3 py-1.5 text-xs font-semibold text-amber-600 bg-amber-50 rounded-lg hover:bg-amber-100">
                Save
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Check stage card actions ────────────────────────────────────────────────
function CheckCardActions({ draft, onProceed }: { draft: ScriptDraft; onProceed: () => void }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  useEffect(() => {
    fetch(`/api/draft-reviews?draftId=${draft.id}`).then(r => r.json()).then(setReviews);
  }, [draft.id]);
  const reviewerIds: string[] = JSON.parse(draft.checkReviewerIds || "[]");
  const allApproved = reviewerIds.length > 0 && reviewerIds.every(id => {
    const rv = reviews.find(r => r.reviewerName !== undefined);
    return reviews.some(r => r.status === "good");
  });
  const hasRejection = reviews.some(r => r.status === "bad");
  const approved = reviews.filter(r => r.status === "good").length;
  const total = reviewerIds.length;

  return (
    <div className="space-y-1">
      {total > 0 && (
        <div className={`text-[10px] font-medium text-center py-1 rounded-lg ${
          hasRejection ? "text-red-600 bg-red-50" : approved === total && total > 0 ? "text-green-600 bg-green-50" : "text-slate-500 bg-slate-50"
        }`}>
          {hasRejection ? "✗ Rejected — needs changes" : approved === total && total > 0 ? "✓ All approved" : `${approved}/${total} approved`}
        </div>
      )}
      <button
        onClick={onProceed}
        disabled={total === 0 || !reviews.length || reviews.some(r => r.status === "bad") || reviews.filter(r => r.status === "good").length < total}
        title={total === 0 ? "Open card to assign reviewers first" : ""}
        className="w-full py-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed">
        → Schedule
      </button>
    </div>
  );
}

// ─── Review panel (Check stage) ─────────────────────────────────────────────
type Reviewer = { id: string; name: string };
type Review = { id: number; reviewerName: string; status: string; comment?: string | null };

function ReviewPanel({ draft, team, ownerName, onReviewSubmitted, onApprovalChange }: {
  draft: ScriptDraft; team: TeamMember[]; ownerName: string; onReviewSubmitted: () => void; onApprovalChange?: (approved: boolean) => void;
}) {
  const [reviewerIds, setReviewerIds] = useState<string[]>(JSON.parse(draft.checkReviewerIds || "[]"));
  const [reviews, setReviews] = useState<Review[]>([]);
  const [badTarget, setBadTarget] = useState<Reviewer | null>(null);
  const [badComment, setBadComment] = useState("");
  const [saving, setSaving] = useState(false);

  const allReviewers: Reviewer[] = [
    { id: "owner", name: ownerName },
    ...team.map((m) => ({ id: String(m.id), name: m.name })),
  ];

  useEffect(() => {
    fetch(`/api/draft-reviews?draftId=${draft.id}`).then(r => r.json()).then(setReviews);
  }, [draft.id]);

  async function toggleReviewer(r: Reviewer) {
    const already = reviewerIds.includes(r.id);
    const next = already ? reviewerIds.filter(id => id !== r.id) : [...reviewerIds, r.id];
    setReviewerIds(next); // instant UI update
    await fetch(`/api/script-drafts/${draft.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkReviewerIds: next }),
    });
    onReviewSubmitted();
  }

  async function submitReview(reviewer: Reviewer, status: "good" | "bad", comment = "") {
    setSaving(true);
    await fetch("/api/draft-reviews", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: draft.id, reviewerName: reviewer.name, reviewerId: reviewer.id === "owner" ? null : reviewer.id, status, comment }),
    });
    const updated = await fetch(`/api/draft-reviews?draftId=${draft.id}`).then(r => r.json());
    setReviews(updated);
    setSaving(false);
    onReviewSubmitted();
  }

  const selectedReviewers = allReviewers.filter(r => reviewerIds.includes(r.id));
  const allApproved = selectedReviewers.length > 0 && selectedReviewers.every(r =>
    reviews.find(rv => rv.reviewerName === r.name)?.status === "good"
  );

  useEffect(() => { onApprovalChange?.(allApproved); }, [allApproved]);

  return (
    <div className="space-y-3">
      {/* Reviewer selector */}
      <div>
        <p className="text-[10px] text-slate-400 mb-2">Select who needs to approve:</p>
        <div className="flex flex-wrap gap-1.5">
          {allReviewers.map((r) => {
            const selected = reviewerIds.includes(r.id);
            const rv = reviews.find(rv => rv.reviewerName === r.name);
            return (
              <button key={r.id} onClick={() => toggleReviewer(r)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all ${
                  selected
                    ? rv?.status === "good" ? "bg-green-100 border-green-400 text-green-700"
                    : rv?.status === "bad" ? "bg-red-100 border-red-400 text-red-700"
                    : "bg-indigo-100 border-indigo-400 text-indigo-700"
                    : "bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-400"
                }`}>
                {rv?.status === "good" ? "✓ " : rv?.status === "bad" ? "✗ " : ""}{r.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-reviewer actions */}
      {selectedReviewers.length > 0 && (
        <div className="space-y-2">
          {selectedReviewers.map((r) => {
            const rv = reviews.find(rv => rv.reviewerName === r.name);
            return (
              <div key={r.id} className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl">
                <span className="text-xs font-medium text-slate-700 flex-1">{r.name}</span>
                {rv?.status === "good" && <span className="text-xs text-green-600 font-semibold">✓ Approved</span>}
                {rv?.status === "bad" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-red-600 font-semibold">✗ Rejected</span>
                    {rv.comment && <span className="text-[10px] text-slate-400 truncate max-w-[120px]">{rv.comment}</span>}
                  </div>
                )}
                {(!rv || rv.status === "pending") && (
                  <div className="flex gap-1">
                    <button onClick={() => submitReview(r, "good")} disabled={saving}
                      className="px-2.5 py-1 text-[10px] font-semibold text-green-700 bg-green-100 rounded-lg hover:bg-green-200">
                      ✓ Good
                    </button>
                    <button onClick={() => { setBadTarget(r); setBadComment(""); }} disabled={saving}
                      className="px-2.5 py-1 text-[10px] font-semibold text-red-600 bg-red-50 rounded-lg hover:bg-red-100">
                      ✗ Bad
                    </button>
                  </div>
                )}
                {rv && rv.status !== "pending" && (
                  <button onClick={() => submitReview(r, rv.status === "good" ? "bad" : "good")} disabled={saving}
                    className="text-[10px] text-slate-400 hover:text-slate-600 ml-1">
                    Change
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {allApproved && (
        <p className="text-xs text-green-600 font-semibold text-center bg-green-50 rounded-xl py-2">
          ✓ All reviewers approved — ready to schedule
        </p>
      )}

      {/* Bad review modal */}
      {badTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 space-y-4">
            <h3 className="text-sm font-bold text-slate-800">Why is this not good?</h3>
            <p className="text-xs text-slate-500">Leave feedback for the editor:</p>
            <textarea value={badComment} onChange={(e) => setBadComment(e.target.value)}
              placeholder="e.g. Audio quality is too low, need to re-record..."
              rows={3}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none" />
            <div className="flex gap-2">
              <button onClick={() => setBadTarget(null)}
                className="flex-1 py-2 text-xs font-medium border border-slate-200 rounded-xl hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={async () => { await submitReview(badTarget, "bad", badComment); setBadTarget(null); }}
                disabled={!badComment.trim() || saving}
                className="flex-1 py-2 text-xs font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 disabled:opacity-40">
                Submit feedback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Finished video upload in detail panel ───────────────────────────────────
function FinishedVideoUpload({ draft, onUploaded }: { draft: ScriptDraft; onUploaded: (url: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(!!draft.editedVideoUrl);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setProgress(0);
    setError("");
    try {
      const url = await cloudinaryUpload(file, (pct) => setProgress(pct));
      onUploaded(url);
      setExpanded(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

      <button
        onClick={() => setExpanded((s) => !s)}
        className="w-full flex items-center justify-between px-3 py-2 bg-orange-50 hover:bg-orange-100 rounded-xl transition-colors border border-orange-100">
        <span className="text-xs font-semibold text-orange-700">
          {draft.editedVideoUrl ? "✓ Finished video uploaded" : "No finished video yet"}
        </span>
        <span className="text-orange-400 text-xs">{expanded ? "▲ Collapse" : "▼ Expand"}</span>
      </button>

      {expanded && draft.editedVideoUrl && (
        <div className="rounded-xl overflow-hidden bg-slate-900 aspect-video">
          <video src={draft.editedVideoUrl} controls className="w-full h-full object-contain" />
        </div>
      )}

      <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={handleFile} />
      {progress !== null ? (
        <div className="w-full rounded-lg border-2 border-orange-200 bg-orange-50 px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-orange-600 font-medium">Uploading…</span>
            <span className="text-xs font-bold text-orange-700">{progress}%</span>
          </div>
          <div className="w-full bg-orange-100 rounded-full h-1.5">
            <div className="bg-orange-500 h-1.5 rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            className="flex-1 py-2 text-sm font-medium border-2 border-dashed border-orange-300 rounded-lg text-orange-500 hover:border-orange-400 hover:text-orange-600 transition-colors">
            {draft.editedVideoUrl ? "⬆ Replace finished video" : "⬆ Add finished video"}
          </button>
          {draft.editedVideoUrl && (
            <button
              onClick={() => { if (confirm("Delete the finished video?")) { onUploaded(null); setExpanded(false); } }}
              className="px-3 py-2 text-xs font-semibold text-red-500 bg-red-50 rounded-lg hover:bg-red-100">
              🗑 Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Raw content upload in detail panel ─────────────────────────────────────
function QRUploadModal({ draft, onClose, onUploaded }: { draft: ScriptDraft; onClose: () => void; onUploaded: () => void }) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/upload-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: draft.id }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.token) setQrUrl(`${window.location.origin}/upload/${d.token}`);
      });
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [draft.id]);

  // Poll for new uploads while modal is open
  useEffect(() => {
    if (!qrUrl) return;
    const initialCount = JSON.parse(draft.rawContentUrls || "[]").length;
    setChecking(true);
    pollRef.current = setInterval(async () => {
      const token = qrUrl.split("/").pop();
      const res = await fetch(`/api/upload-tokens/${token}`);
      const data = await res.json();
      const newCount = JSON.parse(data.rawContentUrls || "[]").length;
      if (newCount > initialCount) {
        clearInterval(pollRef.current!);
        onUploaded();
        onClose();
      }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [qrUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  function copy() {
    if (qrUrl) { navigator.clipboard.writeText(qrUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">Upload from Phone</h3>
            <p className="text-xs text-slate-400 mt-0.5">Scan to open a mobile upload page</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {qrUrl ? (
          <>
            <div className="flex justify-center">
              <div className="p-4 bg-white border-2 border-slate-100 rounded-2xl shadow-inner">
                <QRCodeSVG value={qrUrl} size={200} level="M" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input readOnly value={qrUrl} className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-500 bg-slate-50 focus:outline-none truncate" />
              <button onClick={copy} className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all flex-shrink-0 ${copied ? "bg-green-500 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            {checking && (
              <p className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
                <span className="inline-block w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                Waiting for upload…
              </p>
            )}
          </>
        ) : (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        <p className="text-center text-[11px] text-slate-400">
          The link works once — the page closes automatically once a file is received.
        </p>
      </div>
    </div>
  );
}

function RawContentUpload({ draft, onUploaded }: { draft: ScriptDraft; onUploaded: (urls: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const urls: string[] = JSON.parse(draft.rawContentUrls || "[]");
  const isImage = (u: string) => /\.(jpe?g|png|gif|webp|heic|heif|avif)(\?|$)/i.test(u);

  async function uploadFiles(files: File[]) {
    const media = files.filter((f) => f.type.startsWith("video") || f.type.startsWith("image"));
    if (!media.length) {
      if (files.length) setError("Only video or image files can be uploaded here.");
      return;
    }
    setProgress(0);
    setError("");
    try {
      const newUrls: string[] = [];
      for (let i = 0; i < media.length; i++) {
        const url = await cloudinaryUpload(media[i], (pct) => {
          const overall = ((i / media.length) + pct / 100 / media.length) * 100;
          setProgress(Math.round(overall));
        });
        newUrls.push(url);
      }
      onUploaded([...urls, ...newUrls]);
      setExpanded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    await uploadFiles(Array.from(e.target.files || []));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) uploadFiles(files);
  }

  function removeFile(idx: number) {
    onUploaded(urls.filter((_, i) => i !== idx));
  }

  async function downloadOne(url: string, index: number) {
    // The <a download> attribute is ignored for cross-origin URLs (Cloudinary/R2), so
    // Chrome just opens the file in a tab. Fetch it as a blob and download that instead —
    // works the same in every browser. Falls back to opening if the fetch is blocked.
    // Prefix with the on-screen position so they sort in order in the Downloads folder
    // (Cloudinary/R2 filenames are random IDs, so without this they look shuffled).
    const base = (url.split("?")[0].split("/").pop() || "file");
    let name = `${String(index + 1).padStart(2, "0")}-${base}`;
    if (!/\.[a-z0-9]{2,4}$/i.test(name)) name += ".mp4";
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
    } catch {
      window.open(url, "_blank"); // last resort
    }
  }

  async function downloadAll() {
    for (let i = 0; i < urls.length; i++) {
      await downloadOne(urls[i], i);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return (
    <div
      className={`space-y-2 rounded-xl transition-colors ${dragOver ? "ring-2 ring-indigo-400 ring-offset-2 bg-indigo-50/40" : ""}`}
      onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={onDrop}
    >
      {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

      {/* Collapsible header */}
      <button
        onClick={() => setExpanded((s) => !s)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">
            {urls.length > 0 ? `📎 ${urls.length} file${urls.length > 1 ? "s" : ""} uploaded` : "No files yet"}
          </span>
        </div>
        <span className="text-slate-400 text-xs">{expanded ? "▲ Collapse" : "▼ Expand"}</span>
      </button>

      {expanded && (
        <div className="space-y-2">
          {urls.length > 0 && (
            <>
              <div className="grid grid-cols-4 gap-1.5">
                {urls.map((url, i) => (
                  <div key={i} className="relative group rounded-lg overflow-hidden bg-slate-900 aspect-square">
                    {isImage(url)
                      ? <img src={url} alt="" className="w-full h-full object-cover" />
                      : <video src={url} preload="metadata" muted playsInline className="w-full h-full object-cover" />}
                    {/* Tap anywhere on the tile to view/play it in-app (lightbox) */}
                    <button
                      onClick={() => setPlayUrl(url)}
                      title={isImage(url) ? "View" : "Play"}
                      className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
                      <span className="w-7 h-7 rounded-full bg-white/85 text-slate-900 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                        {isImage(url) ? "🔍" : "▶"}
                      </span>
                    </button>
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
                      ✕
                    </button>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="absolute bottom-1 left-1 text-[8px] bg-black/60 text-white px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      ↗
                    </a>
                    <button onClick={() => downloadOne(url, i)} title="Download"
                      className="absolute bottom-1 right-1 text-[8px] bg-black/60 text-white px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-indigo-600">
                      ⬇
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={downloadAll}
                className="w-full py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center justify-center gap-1.5">
                ⬇ Download all ({urls.length})
              </button>
            </>
          )}
        </div>
      )}

      <input ref={inputRef} type="file" accept="video/*,image/*" multiple className="hidden" onChange={handleFiles} />
      {progress !== null ? (
        <div className="w-full rounded-lg border-2 border-indigo-200 bg-indigo-50 px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-indigo-600 font-medium">Uploading…</span>
            <span className="text-xs font-bold text-indigo-700">{progress}%</span>
          </div>
          <div className="w-full bg-indigo-100 rounded-full h-1.5">
            <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => inputRef.current?.click()}
            className={`flex-1 py-2 text-sm font-medium border-2 border-dashed rounded-lg transition-colors ${
              dragOver ? "border-indigo-500 text-indigo-600 bg-indigo-50" : "border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
            }`}>
            {dragOver ? "⬇ Drop to upload" : "⬆ Add files · or drag & drop"}
          </button>
          <button
            onClick={() => setShowQR(true)}
            title="Generate QR code to upload from phone"
            className="px-3 py-2 text-sm border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-purple-400 hover:text-purple-600 transition-colors">
            📱 QR
          </button>
        </div>
      )}

      {playUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPlayUrl(null)}>
          <button
            onClick={() => setPlayUrl(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 text-white text-lg flex items-center justify-center hover:bg-white/25">
            ✕
          </button>
          {isImage(playUrl) ? (
            <img
              src={playUrl}
              alt=""
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-full object-contain rounded-lg" />
          ) : (
            <video
              src={playUrl}
              controls
              autoPlay
              playsInline
              onClick={(e) => e.stopPropagation()}
              onError={(e) => {
                // Same proxy fallback we use elsewhere — if R2/Cloudinary blocks direct
                // playback, route through our own origin so it always plays.
                const v = e.currentTarget;
                const proxied = `/api/vid?u=${encodeURIComponent(playUrl)}`;
                if (!v.src.includes("/api/vid")) v.src = proxied;
              }}
              className="max-w-full max-h-full rounded-lg bg-black" />
          )}
        </div>
      )}

      {showQR && (
        <QRUploadModal
          draft={draft}
          onClose={() => setShowQR(false)}
          onUploaded={() => {
            // Re-fetch updated URLs from API
            fetch(`/api/script-drafts/${draft.id}`)
              .then((r) => r.json())
              .then((d) => {
                const updatedUrls: string[] = JSON.parse(d.rawContentUrls || "[]");
                onUploaded(updatedUrls);
              });
            setShowQR(false);
            setExpanded(true);
          }}
        />
      )}
    </div>
  );
}

// ─── Generate scripts modal ─────────────────────────────────────────────────
// ─── Import an existing script (from Google Docs etc.) as an Idea ────────────
function ImportScriptModal({ client, concepts, stages, onClose, onImported }: {
  client: Client; concepts: Concept[]; stages: WorkflowStage[]; onClose: () => void; onImported: () => void;
}) {
  const [conceptId, setConceptId] = useState<number | "">(concepts[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [hook, setHook] = useState("");
  const [script, setScript] = useState("");
  const [caption, setCaption] = useState("");
  const [seedAsExample, setSeedAsExample] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stageId, setStageId] = useState<number | "">("");      // "" = Ideas
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Example/reference recording for the person filming to copy.
  const [exampleUrl, setExampleUrl] = useState<string | null>(null);
  const [examplePct, setExamplePct] = useState<number | null>(null);
  const exampleRef = useRef<HTMLInputElement>(null);
  async function uploadExample(file: File) {
    setExamplePct(0);
    try {
      const url = await cloudinaryUpload(file, (pct) => setExamplePct(pct));
      setExampleUrl(url);
      autoExtract(url); // read the example's script/on-screen text as a starting template
    }
    catch (e) { alert("Upload failed: " + (e instanceof Error ? e.message : String(e))); }
    finally { setExamplePct(null); }
  }
  // B-roll + on-screen text format (no spoken script). Defaults to the concept's
  // flag but you can toggle it per import.
  const [textOverlay, setTextOverlay] = useState<boolean>(() => (concepts[0] as any)?.textOverlay === true);
  useEffect(() => {
    const c = concepts.find((x) => x.id === conceptId);
    setTextOverlay((c as any)?.textOverlay === true);
  }, [conceptId]); // eslint-disable-line react-hooks/exhaustive-deps

  // After upload, auto-read the video: transcribe (talking-head) or read the on-screen
  // text (B-roll). Pre-fills the relevant field; the user can edit before importing.
  async function autoExtract(url: string) {
    setExtracting(true);
    try {
      const mode = textOverlay ? "onscreen" : "transcribe";
      const d = await fetch("/api/import-extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: url, mode }),
      }).then((r) => r.json()).catch(() => ({ text: "" }));
      const text = (d?.text || "").trim();
      if (!text) return;
      if (textOverlay) {
        setHook((h) => h.trim() ? h : text.split("\n")[0]);
        setScript((s) => s.trim() ? s : text);
      } else {
        setScript((s) => s.trim() ? s : text);
      }
    } finally { setExtracting(false); }
  }

  async function uploadVideo(file: File) {
    setUploadPct(0);
    try {
      const url = await cloudinaryUpload(file, (pct) => setUploadPct(pct));
      setVideoUrl(url);
      autoExtract(url); // fire-and-forget: fills script/hook in the background
    } catch (e) { alert("Upload failed: " + (e instanceof Error ? e.message : String(e))); }
    finally { setUploadPct(null); }
  }

  const weekLabel = (() => {
    const d = new Date();
    const oneJan = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil((((d.getTime() - oneJan.getTime()) / 86400000) + oneJan.getDay() + 1) / 7);
    return `Week ${week}`;
  })();

    // B-roll + on-screen-text concepts (the Viral text-hook format) have no spoken
    // script — just the video + the on-screen text hook. So we don't force a script.
    const isTextOverlay = textOverlay;
    // For those, the "script" stored is the on-screen text (script field) or the hook.
    const canSubmit = !!conceptId && (isTextOverlay ? (!!videoUrl || !!script.trim() || !!hook.trim()) : !!script.trim());

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const concept = concepts.find((c) => c.id === conceptId);
      const conceptLbl = concept ? ((concept as any).conceptType ? `${(concept as any).conceptType} · ${concept.name}` : concept.name) : "Script";
      // For text-overlay imports the script may be empty — store the on-screen text or hook.
      const scriptToSave = script.trim() || (isTextOverlay ? hook.trim() : "");
      // Default title: first words of the hook/script (a real title), else concept · week.
      const firstLine = (hook.trim() || scriptToSave).split(/\n/)[0];
      const autoTitle = firstLine ? firstLine.split(/\s+/).slice(0, 8).join(" ") : `${conceptLbl} · ${weekLabel}`;
      await fetch("/api/script-drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          conceptId,
          title: title.trim() || autoTitle,
          hook: hook.trim() || null,
          script: scriptToSave,
          caption: caption.trim() || null,
          weekLabel,
          seedAsExample,
          editedVideoUrl: videoUrl,
          exampleVideoUrl: exampleUrl,
          stageId: stageId || null,
        }),
      });
      // Persist the format choice onto the concept so the generator also knows it's a
      // B-roll/text-hook concept (not just this one import).
      if (concept && (concept as any).textOverlay !== textOverlay) {
        fetch(`/api/concepts/${conceptId}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ textOverlay }),
        }).catch(() => {});
      }
      onImported();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800">⬇ Import content</h2>
            <p className="text-xs text-slate-400 mt-0.5">Transfer existing content — script + finished video — into a concept. The AI learns from the script.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 space-y-3">
          {isTextOverlay && (
            <div className="rounded-lg bg-violet-50 border border-violet-200 px-3 py-2 text-[11px] text-violet-700">
              🎬 This is a <b>B-roll + on-screen text</b> concept — no spoken script. Just drop the video (and the on-screen text hook if you have it); the script is optional.
            </div>
          )}
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Concept</label>
            {concepts.length === 0 ? (
              <p className="text-xs text-slate-400">No concepts yet — add one in the Concept Library first.</p>
            ) : (
              <select value={conceptId} onChange={(e) => setConceptId(e.target.value ? parseInt(e.target.value) : "")}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>{(c as any).conceptType ? `${(c as any).conceptType} · ` : ""}{c.name}</option>
                ))}
              </select>
            )}
          </div>
          {/* Mark the format — B-roll/text-hook (no spoken script) vs talking-head. */}
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={textOverlay} onChange={(e) => setTextOverlay(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-violet-600 focus:ring-violet-400" />
            <span className="text-xs text-slate-600 leading-relaxed">
              <span className="font-semibold text-slate-700">🎬 B-roll + on-screen text (no spoken script)</span> — the Viral text-hook format. Tick this and you only need the video; the script becomes optional. (Also saved to the concept.)
            </span>
          </label>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Title (optional)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">{isTextOverlay ? "Text hook (on-screen) — optional" : "Hook (optional)"}</label>
            <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder={isTextOverlay ? "The on-screen text hook…" : "Opening hook line…"}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="flex items-center gap-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
              {isTextOverlay ? "On-screen text (optional)" : "Script *"}
              {extracting && <span className="text-violet-500 normal-case font-medium tracking-normal">✨ reading video…</span>}
            </label>
            <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={isTextOverlay ? 4 : 8} placeholder={isTextOverlay ? "On-screen text, if any (optional)…" : "Paste the full script here…"}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Caption (optional)</label>
            <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={2} placeholder="Caption, if you have one…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          {/* Finished video — for transferred content that's already produced. */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Finished video (optional)</label>
            <input ref={fileRef} type="file" accept="video/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVideo(f); }} />
            {videoUrl ? (
              <div className="flex items-center justify-between border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">
                <span className="text-xs text-emerald-700 font-medium truncate">✓ Video uploaded{extracting ? " · ✨ reading…" : ""}</span>
                <button onClick={() => { setVideoUrl(null); if (fileRef.current) fileRef.current.value = ""; }}
                  className="text-[11px] text-slate-400 hover:text-red-500 flex-shrink-0 ml-2">Remove</button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} disabled={uploadPct !== null}
                className="w-full border border-dashed border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-60">
                {uploadPct !== null ? `Uploading ${uploadPct}%…` : "⬆ Upload the finished video"}
              </button>
            )}
          </div>
          {/* Example / reference video — what the person filming should copy. */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Example video — for the recorder to copy (optional)</label>
            <input ref={exampleRef} type="file" accept="video/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadExample(f); }} />
            {exampleUrl ? (
              <div className="flex items-center justify-between border border-amber-200 bg-amber-50 rounded-lg px-3 py-2">
                <span className="text-xs text-amber-700 font-medium truncate">🎬 Example uploaded</span>
                <button onClick={() => { setExampleUrl(null); if (exampleRef.current) exampleRef.current.value = ""; }}
                  className="text-[11px] text-slate-400 hover:text-red-500 flex-shrink-0 ml-2">Remove</button>
              </div>
            ) : (
              <button onClick={() => exampleRef.current?.click()} disabled={examplePct !== null}
                className="w-full border border-dashed border-slate-300 rounded-lg px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-60">
                {examplePct !== null ? `Uploading ${examplePct}%…` : "⬆ Upload an example to copy"}
              </button>
            )}
          </div>
          {/* Where it lands — Ideas (still needs production) or straight into a stage. */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Place in</label>
            <select value={stageId} onChange={(e) => setStageId(e.target.value ? parseInt(e.target.value) : "")}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              <option value="">💡 Ideas (needs review)</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <p className="text-[10px] text-slate-400 mt-1">Transferring already-finished content? Drop it straight into a later stage (e.g. Schedule).</p>
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input type="checkbox" checked={seedAsExample} onChange={(e) => setSeedAsExample(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
            <span className="text-xs text-slate-600 leading-relaxed">
              <span className="font-semibold text-slate-700">🧠 Teach the AI this belongs to the concept</span> — adds it to AI Context as an example so future generated scripts learn from it.
            </span>
          </label>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={saving || uploadPct !== null || !canSubmit}
            className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
            {saving ? "Importing…" : uploadPct !== null ? "Uploading video…" : "⬇ Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GenerateModal({ client, concepts, onClose, onGenerated }: {
  client: Client; concepts: Concept[]; onClose: () => void; onGenerated: () => void;
}) {
  // Client-owned concepts are written by the client themselves (assigned in Script
  // Tasks) — the AI must not generate scripts for them, so they're excluded here.
  const genConcepts = concepts.filter((c) => !(c as any).clientOwned);
  const [selectedConcepts, setSelectedConcepts] = useState<number[]>(genConcepts.map((c) => c.id));
  const [weekLabel, setWeekLabel] = useState(`Week ${WEEK_NUMBER}`);
  const [dayLabel, setDayLabel] = useState("");
  const [count, setCount] = useState(client.scriptAlternatives);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  function toggleConcept(id: number) {
    setSelectedConcepts((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]);
  }

  async function generate() {
    if (selectedConcepts.length === 0) { setError("Select at least one concept."); return; }
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/script-drafts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id, conceptIds: selectedConcepts,
          weekLabel, dayLabel: dayLabel || null, count,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Generation failed."); return; }
      onGenerated();
    } catch {
      setError("Generation failed. Check your API key.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">✨ Generate Scripts</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 space-y-5">
          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600">Concepts</label>
              <button onClick={() => setSelectedConcepts(selectedConcepts.length === genConcepts.length ? [] : genConcepts.map((c) => c.id))}
                className="text-xs text-indigo-600 hover:underline">
                {selectedConcepts.length === genConcepts.length ? "Deselect all" : "Select all"}
              </button>
            </div>
            {genConcepts.length === 0 ? (
              <p className="text-xs text-slate-400">No AI concepts — these are all client-written, or add some in the Concept Library first.</p>
            ) : (
              <div className="space-y-1.5">
                {genConcepts.map((c) => (
                  <button key={c.id} onClick={() => toggleConcept(c.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left text-xs font-medium transition-all ${
                      selectedConcepts.includes(c.id)
                        ? "bg-indigo-50 border-indigo-300 text-indigo-700"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                    }`}>
                    <span className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 ${
                      selectedConcepts.includes(c.id) ? "bg-indigo-600 border-indigo-600" : "border-slate-300 bg-white"
                    }`}>
                      {selectedConcepts.includes(c.id) && <span className="text-white text-[9px] font-bold">✓</span>}
                    </span>
                    {(c as any).conceptType ? <><span className="opacity-50">{(c as any).conceptType} · </span>{c.name}</> : c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Week label</label>
              <input value={weekLabel} onChange={(e) => setWeekLabel(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Day (optional)</label>
              <input value={dayLabel} onChange={(e) => setDayLabel(e.target.value)}
                placeholder="e.g. Monday"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Alternatives per concept</label>
            <div className="flex items-center gap-3">
              {[2, 3, 5, 7].map((n) => (
                <button key={n} onClick={() => setCount(n)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
                    count === n ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}>
                  {n}
                </button>
              ))}
              <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(parseInt(e.target.value) || 3)}
                className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          {selectedConcepts.length > 0 && (
            <p className="text-xs text-slate-400">
              Will generate <strong className="text-slate-700">{count * selectedConcepts.length} scripts</strong> total
              ({count} × {selectedConcepts.length} concept{selectedConcepts.length > 1 ? "s" : ""})
            </p>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={generate} disabled={generating || selectedConcepts.length === 0}
            className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50">
            {generating ? "Generating…" : `✨ Generate ${count * selectedConcepts.length} scripts`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Batch generate modal ───────────────────────────────────────────────────
// Generate a whole period's worth of content: pick a duration + concepts, and it makes the
// right number PER concept (based on each concept's posting cadence), minus what you already
// have, so one click fills the batch "as needed".
function postsPerWeekOf(c: Concept): number {
  const days = ((c as any).postDays || "").split(/[,;/]+|\s+/).filter(Boolean).length;
  return days > 0 ? days : 1;
}
function BatchModal({ client, concepts, drafts, onClose, onGenerated }: {
  client: Client; concepts: Concept[]; drafts: ScriptDraft[]; onClose: () => void; onGenerated: () => void;
}) {
  const genConcepts = concepts.filter((c) => !(c as any).clientOwned);
  const [weeks, setWeeks] = useState(1);
  const [selected, setSelected] = useState<number[]>(genConcepts.map((c) => c.id));
  const [weekLabel, setWeekLabel] = useState(`Week ${WEEK_NUMBER}`);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  // The Content Scheduling day template ({ weekday: conceptId }) is the source of truth: how
  // many days per week each concept is assigned. Fall back to the concept's own cadence only
  // if no template is set up yet.
  const template: Record<string, number | null> = (() => {
    try { return JSON.parse((client as any).dayTemplate || "{}"); } catch { return {}; }
  })();
  const hasTemplate = Object.values(template).some((v) => v != null);
  const perWeekOf = (c: Concept) => hasTemplate
    ? Object.values(template).filter((v) => v === c.id).length
    : postsPerWeekOf(c);

  // What each concept still NEEDS = (calendar days/week × weeks) minus what's already on the
  // board. Recomputed whenever the duration changes.
  useEffect(() => {
    const next: Record<number, number> = {};
    for (const c of genConcepts) {
      const target = perWeekOf(c) * weeks;
      const have = drafts.filter((d) => d.conceptId === c.id).length;
      next[c.id] = Math.max(0, target - have);
    }
    setCounts(next);
  }, [weeks]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: number) { setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]); }
  const total = selected.reduce((s, id) => s + (counts[id] || 0), 0);

  async function generate() {
    const active = selected.filter((id) => (counts[id] || 0) > 0);
    if (!active.length) { setError("Nothing to generate — every concept is already covered or set to 0."); return; }
    setGenerating(true); setError("");
    try {
      const countsPayload: Record<number, number> = {};
      for (const id of active) countsPayload[id] = counts[id];
      const res = await fetch("/api/script-drafts/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, conceptIds: active, counts: countsPayload, weekLabel, dayLabel: null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Generation failed."); return; }
      onGenerated();
    } catch { setError("Generation failed. Check your API key."); }
    finally { setGenerating(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800">📦 Generate Batch</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Counts from your Content Scheduling day template — how many days each concept is assigned × the period, minus what you have.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 space-y-5">
          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Batch length</label>
            <div className="flex gap-2">
              {[[1, "1 week"], [2, "2 weeks"], [4, "1 month"]].map(([w, lbl]) => (
                <button key={w} onClick={() => setWeeks(w as number)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${weeks === w ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600">Concepts in the batch</label>
              <button onClick={() => setSelected(selected.length === genConcepts.length ? [] : genConcepts.map((c) => c.id))}
                className="text-xs text-indigo-600 hover:underline">{selected.length === genConcepts.length ? "Deselect all" : "Select all"}</button>
            </div>
            {genConcepts.length === 0 ? (
              <p className="text-xs text-slate-400">No AI concepts — add some in the Concept Library first.</p>
            ) : (
              <div className="space-y-1.5">
                {genConcepts.map((c) => {
                  const on = selected.includes(c.id);
                  const label = (c as any).conceptType ? `${(c as any).conceptType} · ${c.name}` : c.name;
                  const have = drafts.filter((d) => d.conceptId === c.id).length;
                  return (
                    <div key={c.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs ${on ? "bg-indigo-50 border-indigo-200" : "bg-slate-50 border-slate-200 opacity-60"}`}>
                      <button onClick={() => toggle(c.id)} className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 ${on ? "bg-indigo-600 border-indigo-600" : "border-slate-300 bg-white"}`}>
                        {on && <span className="text-white text-[9px] font-bold">✓</span>}
                      </button>
                      <span className="flex-1 font-medium text-slate-700 truncate" title={label}>{label}</span>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">{perWeekOf(c)}/wk · have {have}</span>
                      <input type="number" min={0} value={counts[c.id] ?? 0} disabled={!on}
                        onChange={(e) => setCounts((p) => ({ ...p, [c.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                        className="w-12 border border-slate-200 rounded-lg px-1.5 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-40" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Week label</label>
            <input value={weekLabel} onChange={(e) => setWeekLabel(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>

          <p className="text-xs text-slate-400">Will generate <strong className="text-slate-700">{total} scripts</strong> across {selected.filter((id) => (counts[id] || 0) > 0).length} concept{selected.filter((id) => (counts[id] || 0) > 0).length !== 1 ? "s" : ""} — enough to cover the next {weeks === 4 ? "month" : `${weeks} week${weeks > 1 ? "s" : ""}`}.</p>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={generate} disabled={generating || total === 0}
            className="px-5 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50">
            {generating ? "Generating…" : `📦 Generate ${total} scripts`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stage manager modal ────────────────────────────────────────────────────
// Remix a proven winner: paste one reel that performed, pick the concept whose voice/format
// to use, and spin N variations that say the SAME message a different way.
function RemixModal({ client, concepts, onClose, onGenerated }: {
  client: Client; concepts: Concept[]; onClose: () => void; onGenerated: () => void;
}) {
  // Any concept can host a remix EXCEPT client-written ones (those are written by the client).
  const remixConcepts = concepts.filter((c) => !(c as any).clientOwned);
  const [conceptId, setConceptId] = useState<number | null>(remixConcepts[0]?.id ?? null);
  const [source, setSource] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [weekLabel, setWeekLabel] = useState(`Week ${WEEK_NUMBER}`);
  const [dayLabel, setDayLabel] = useState("");
  const [count, setCount] = useState(client.scriptAlternatives);
  const [format, setFormat] = useState<"auto" | "spoken" | "text">("auto");
  const [keepHook, setKeepHook] = useState(true);
  const [hookAltCount, setHookAltCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [showReelPicker, setShowReelPicker] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // A reel was picked from the profile grid → pull its spoken script via transcription and
  // drop it into the source box. (Best for talking-head reels; silent on-screen-text reels
  // have no audio, so those still get pasted by hand.)
  async function onReelPicked(reel: any) {
    setShowReelPicker(false);
    const cap = (reel.caption || "").split("\n")[0]?.slice(0, 60) || "";
    setSourceTitle(cap || (reel.plays != null ? `${reel.plays >= 1000 ? (reel.plays / 1000).toFixed(1) + "K" : reel.plays} views` : ""));
    if (!reel.media_url) { setError("That reel has no playable video to transcribe — paste its text instead."); return; }
    setTranscribing(true);
    setError("");
    try {
      const res = await fetch("/api/instagram/transcribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaUrl: reel.media_url }),
      });
      const d = await res.json();
      if (!res.ok || !d.transcript?.trim()) {
        setError(d.error?.includes("too long") ? "This reel is too long to auto-transcribe — paste its text instead." : "Couldn't read this reel's audio (it may be a text-only reel). Paste its on-screen text instead.");
        return;
      }
      setSource(d.transcript.trim());
    } catch {
      setError("Transcription failed — paste the reel's text instead.");
    } finally {
      setTranscribing(false);
    }
  }

  async function generate() {
    if (!conceptId) { setError("Pick a concept to remix into."); return; }
    if (!source.trim()) { setError("Paste the winning reel's script first."); return; }
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/script-drafts/remix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id, conceptId, source, sourceTitle: sourceTitle || null,
          weekLabel, dayLabel: dayLabel || null, count, format, keepHook, hookAltCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Remix failed."); return; }
      onGenerated();
    } catch {
      setError("Remix failed. Check your API key.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-[520px] max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800">♻️ Remix a Winner</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Take one reel that performed → market that same message {count} different ways.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 space-y-5">
          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-600">The winning reel</label>
              <button type="button" onClick={() => setShowReelPicker(true)} disabled={transcribing}
                className="text-[11px] font-semibold text-purple-600 hover:text-purple-800 disabled:opacity-50">
                🎬 Pick from {client.name}'s reels
              </button>
            </div>
            <textarea rows={6} value={source} onChange={(e) => setSource(e.target.value)}
              placeholder="Pick a reel above to auto-pull its script — or paste the exact script / on-screen text of the reel that already performed…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none" />
            {transcribing && <p className="mt-1 text-[11px] text-purple-600">⏳ Reading the reel's audio…</p>}
            <input value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)}
              placeholder="Optional: a label for this winner (e.g. '250k views — survival mode')"
              className="mt-2 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Match to concept (voice & format)</label>
            {remixConcepts.length === 0 ? (
              <p className="text-xs text-slate-400">No AI concepts yet — add one in the Concept Library first.</p>
            ) : (
              <select value={conceptId ?? ""} onChange={(e) => setConceptId(parseInt(e.target.value))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                {remixConcepts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c as any).conceptType ? `${(c as any).conceptType} · ${c.name}` : c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Week label</label>
              <input value={weekLabel} onChange={(e) => setWeekLabel(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Day (optional)</label>
              <input value={dayLabel} onChange={(e) => setDayLabel(e.target.value)} placeholder="e.g. Monday"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Output format</label>
            <div className="flex gap-2">
              {([["auto", "Match concept"], ["spoken", "🎤 Spoken script"], ["text", "📝 On-screen text"]] as const).map(([v, lbl]) => (
                <button key={v} onClick={() => setFormat(v)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                    format === v ? "bg-purple-600 text-white border-purple-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}>
                  {lbl}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              {format === "spoken" ? "Full talking-head script (~80–130 words)." : format === "text" ? "Short on-screen text cards (4–8 lines)." : "Auto-picks based on the concept's format."}
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2.5">
            <label className="block text-xs font-semibold text-slate-600">The hook</label>
            <div className="flex gap-2">
              <button onClick={() => setKeepHook(true)}
                className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${keepHook ? "bg-purple-600 text-white border-purple-600" : "border-slate-200 text-slate-600 bg-white hover:bg-slate-50"}`}>
                🔒 Keep the winner's hook
              </button>
              <button onClick={() => setKeepHook(false)}
                className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${!keepHook ? "bg-purple-600 text-white border-purple-600" : "border-slate-200 text-slate-600 bg-white hover:bg-slate-50"}`}>
                ✍️ Rewrite the hook
              </button>
            </div>
            <p className="text-[10px] text-slate-400">
              {keepHook ? "Every variation opens with the proven hook — only the body changes." : "Each variation gets a fresh hook."}
            </p>
            <div className="flex items-center gap-2 pt-0.5">
              <span className="text-[11px] font-semibold text-slate-600">Alternative hooks per script</span>
              {[0, 2, 3, 5].map((n) => (
                <button key={n} onClick={() => setHookAltCount(n)}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold border transition-all ${hookAltCount === n ? "bg-white text-purple-700 border-purple-300 shadow-sm" : "border-slate-200 text-slate-500 bg-white hover:bg-slate-50"}`}>
                  {n === 0 ? "none" : n}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-400">Extra hook options you can pick from on each idea card before recording.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">How many variations</label>
            <div className="flex items-center gap-3">
              {[3, 5, 7, 10].map((n) => (
                <button key={n} onClick={() => setCount(n)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
                    count === n ? "bg-purple-600 text-white border-purple-600" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}>
                  {n}
                </button>
              ))}
              <input type="number" min={1} max={30} value={count} onChange={(e) => setCount(parseInt(e.target.value) || 5)}
                className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-purple-400" />
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={generate} disabled={generating || !conceptId || !source.trim()}
            className="px-5 py-2 text-sm font-semibold bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:opacity-50">
            {generating ? "Remixing…" : `♻️ Make ${count} variations`}
          </button>
        </div>
      </div>

      {showReelPicker && (
        <RemixReelPicker clientId={client.id} clientName={client.name}
          onClose={() => setShowReelPicker(false)} onPick={onReelPicked} />
      )}
    </div>
  );
}

// Single-select reel grid for the remix flow — browse the client's posted IG reels, click one.
function RemixReelPicker({ clientId, clientName, onClose, onPick }: {
  clientId: number; clientName: string; onClose: () => void; onPick: (reel: any) => void;
}) {
  const [reels, setReels] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sort, setSort] = useState<"recent" | "views">("recent");
  const [ranking, setRanking] = useState(false);

  // Returns the next cursor so we can chain pages for the "top performers" ranking.
  async function loadPage(c: string | null): Promise<string | null> {
    const url = `/api/instagram/media?clientId=${clientId}${c ? `&cursor=${encodeURIComponent(c)}` : ""}`;
    const d = await fetch(url).then((r) => r.json()).catch(() => ({}));
    const page = Array.isArray(d?.reels) ? d.reels : Array.isArray(d) ? d : [];
    setReels((prev) => (c ? [...prev, ...page] : page));
    const next = d?.nextCursor ?? null;
    setCursor(next);
    return next;
  }
  useEffect(() => { setLoading(true); loadPage(null).finally(() => setLoading(false)); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (sort === "recent" && cursor && !loadingMore && el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
      setLoadingMore(true);
      loadPage(cursor).finally(() => setLoadingMore(false));
    }
  }

  // "Top performers" needs the whole library (IG returns reels newest-first, so the best
  // performer could be 40 reels deep). Pull remaining pages, then sort by plays.
  async function rankByViews() {
    setSort("views");
    if (!cursor || ranking) return;
    setRanking(true);
    let c: string | null = cursor;
    let guard = 0;
    while (c && guard < 20) { c = await loadPage(c); guard++; }
    setRanking(false);
  }

  const displayed = sort === "views"
    ? [...reels].sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0))
    : reels;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[620px] max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">Pick a winning reel</h3>
            <p className="text-[11px] text-slate-400">Click the reel that performed — we'll pull its script automatically.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-100 rounded-lg p-0.5 text-[11px] font-semibold">
              <button onClick={() => setSort("recent")}
                className={`px-2.5 py-1 rounded-md transition-colors ${sort === "recent" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                Recent
              </button>
              <button onClick={rankByViews}
                className={`px-2.5 py-1 rounded-md transition-colors ${sort === "views" ? "bg-white text-purple-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                🔥 Top performers
              </button>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
          </div>
        </div>
        <div className="p-4 overflow-y-auto" onScroll={onScroll}>
          {sort === "views" && ranking && <p className="mb-2 text-[11px] text-purple-600 text-center">⏳ Ranking all reels by views…</p>}
          {loading ? (
            <div className="py-16 text-center text-sm text-slate-400">Loading {clientName}'s reels…</div>
          ) : displayed.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-400">No reels found — is Instagram connected for {clientName}?</div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {displayed.map((r) => (
                <button key={r.id} type="button" onClick={() => onPick(r)}
                  className="relative aspect-[9/16] rounded-lg overflow-hidden border-2 border-transparent hover:border-purple-400 transition-all group">
                  {r.thumbnail_url
                    ? <img src={r.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full bg-slate-800 flex items-center justify-center text-slate-500">▶</div>}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  {r.timestamp && <span className="absolute top-1 left-1 text-[8px] text-white bg-black/50 px-1 rounded">{new Date(r.timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                  {r.plays != null && <span className="absolute bottom-1 left-1 text-[10px] font-bold text-white">▶ {r.plays >= 1000 ? (r.plays / 1000).toFixed(1) + "K" : r.plays}</span>}
                  <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="px-2 py-1 rounded-md bg-purple-600 text-white text-[10px] font-bold">♻️ Remix this</span>
                  </span>
                </button>
              ))}
              {loadingMore && <div className="col-span-4 py-3 text-center text-xs text-slate-400">Loading more…</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StageManagerModal({ client, stages, team, creators, ownerName, onClose, onSaved }: {
  client: Client; stages: WorkflowStage[]; team: TeamMember[]; creators: Creator[]; ownerName: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [list, setList] = useState(stages.map((s) => ({ ...s, _assignees: getStageAssignees(s) })));

  const allPeople: { value: PersonValue; label: string; color: string }[] = [
    { value: "owner", label: ownerName, color: "#6366f1" },
    { value: "client", label: client.name, color: client.color },
    // Exclude the client's own login account — it's already represented by the
    // "client" chip above (otherwise the client shows up twice with the same name).
    ...team.filter((m) => !m.isClientAccount).map((m) => ({ value: `member:${m.id}` as PersonValue, label: m.name, color: m.color })),
    ...creators.map((c) => ({ value: `creator:${c.id}` as PersonValue, label: c.name, color: c.color })),
  ];

  async function togglePerson(stageId: number, v: PersonValue) {
    const updated = list.map((s) => {
      if (s.id !== stageId) return s;
      const cur = s._assignees;
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      return { ...s, _assignees: next, assignees: JSON.stringify(next) };
    });
    setList(updated);
    await fetch("/api/workflow", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: client.id, stages: updated }),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-[500px] max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-800">Assign Stages · {client.name}</h2>
            <p className="text-xs text-slate-400 mt-0.5">Select everyone responsible for each stage</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="px-6 py-5 space-y-3">
          {list.map((stage) => (
            <div key={stage.id} className="p-3 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-2 mb-2.5">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
                <span className="text-sm text-slate-700 font-semibold">{stage.name}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allPeople.map((p) => {
                  const selected = stage._assignees.includes(p.value);
                  return (
                    <button key={p.value} onClick={() => togglePerson(stage.id, p.value)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                        selected ? "text-white border-transparent" : "bg-white border-slate-200 text-slate-500 hover:border-slate-400"
                      }`}
                      style={selected ? { backgroundColor: p.color, borderColor: p.color } : {}}>
                      <span className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center text-white flex-shrink-0"
                        style={{ backgroundColor: selected ? "rgba(255,255,255,0.3)" : p.color }}>
                        {p.label[0].toUpperCase()}
                      </span>
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end">
          <button onClick={onSaved}
            className="px-5 py-2 text-sm font-semibold bg-slate-800 text-white rounded-xl hover:bg-slate-900">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Rejection Reason Modal ─────────────────────────────────────────────────

const REJECT_REASONS = [
  { value: "others_better", label: "Others were better", emoji: "🏆" },
  { value: "wrong_angle",   label: "Wrong angle / topic", emoji: "🎯" },
  { value: "hook_bad",      label: "Hook doesn't land", emoji: "🪝" },
  { value: "too_long",      label: "Too long", emoji: "📏" },
  { value: "too_short",     label: "Too short", emoji: "✂️" },
  { value: "off_brand",     label: "Off-brand", emoji: "🚫" },
  { value: "custom",        label: "Other reason…", emoji: "✏️" },
];

function RejectModal({
  draft, onCancel, onConfirm, onDeleteOnly, replace = false,
}: {
  draft: ScriptDraft;
  onCancel: () => void;
  onConfirm: (reasonType: string, reason: string) => void;
  onDeleteOnly: () => void;
  replace?: boolean;
}) {
  // Pre-fill with the creator's feedback if this was sent back, so the owner can
  // reject it into AI training with one click (editable).
  const [selected, setSelected] = useState<string | null>(draft.rejectionFeedback ? "custom" : null);
  const [customText, setCustomText] = useState(draft.rejectionFeedback || "");

  function handleConfirm() {
    if (!selected) return;
    onConfirm(selected, selected === "custom" ? customText : "");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-bold text-slate-800">{replace ? "Why replace this one?" : draft.clientAuthored ? "Send back for changes" : "Why are you rejecting this?"}</h2>
          <p className="text-xs text-slate-400 mt-0.5 truncate">"{draft.title}"</p>
          <p className="text-[10px] text-indigo-500 mt-0.5">
            {replace
              ? "Claude learns from this, then writes a fresh script for this concept to replace it."
              : draft.clientAuthored
              ? "The client sees this feedback on their Script Tasks page and can revise & resubmit."
              : "Claude will learn from this for future scripts on this concept."}
          </p>
        </div>

        <div className="space-y-2">
          {REJECT_REASONS.map((r) => (
            <button
              key={r.value}
              onClick={() => setSelected(r.value)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm text-left transition-all ${
                selected === r.value
                  ? "border-red-400 bg-red-50 text-red-700 font-semibold"
                  : "border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <span>{r.emoji}</span>
              <span>{r.label}</span>
            </button>
          ))}
        </div>

        {selected === "custom" && (
          <textarea
            autoFocus
            placeholder="Describe what didn't work…"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            rows={3}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-red-200 resize-none"
          />
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={onCancel} className="flex-1 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-700 border border-slate-200 rounded-xl">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selected || (selected === "custom" && !customText.trim())}
            className="flex-1 py-2.5 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl disabled:opacity-40 transition-colors"
          >
            {replace ? "🔄 Replace with a new one" : draft.clientAuthored ? "↩ Send back to client" : "✗ Reject & Delete"}
          </button>
        </div>

        {/* Delete/replace without teaching the AI / notifying the client — no reason needed. */}
        <button
          onClick={onDeleteOnly}
          className="w-full text-center text-xs font-medium text-slate-400 hover:text-red-500 pt-1"
        >
          {replace ? "🔄 Just replace — don't teach the AI" : `🗑 Just delete — don't teach the AI${draft.clientAuthored ? " or notify the client" : ""}`}
        </button>
      </div>
    </div>
  );
}

