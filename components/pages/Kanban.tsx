"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { upload } from "@vercel/blob/client";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Client, Concept, WorkflowStage, ScriptDraft, TeamMember, Creator } from "@/lib/types";

type Props = {
  clients: Client[];
  selectedClientId: number | null;
  onSelectClient: (id: number | null) => void;
  activeProfileId: number | null;
  team: TeamMember[];
  ownerName?: string;
  isClient?: boolean;
};

const WEEK_NUMBER = Math.ceil(
  (Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000)
);

// ─── Draggable card shell ───────────────────────────────────────────────────
function DraggableCard({ draft, onClick }: { draft: ScriptDraft; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: String(draft.id) });
  const style = transform
    ? { transform: `translate(${transform.x}px,${transform.y}px)`, opacity: isDragging ? 0.4 : 1 }
    : {};
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="touch-none cursor-grab active:cursor-grabbing"
    >
      <CardContent draft={draft} />
    </div>
  );
}

// ─── Card content ────────────────────────────────────────────────────────────
function CardContent({ draft }: { draft: ScriptDraft }) {
  return (
    <div className={`bg-white rounded-xl border p-3 shadow-sm hover:shadow-md transition-all select-none ${
      draft.isSavedIdea ? "border-amber-200 bg-amber-50/30" : "border-slate-200"
    }`}>
      {draft.isSavedIdea && (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full mb-2">
          ↩ Returning idea
        </span>
      )}
      <p className="text-xs font-semibold text-slate-800 truncate">{draft.title}</p>
      {draft.concept && (
        <p className="text-[10px] text-indigo-500 font-medium mt-0.5">{draft.concept.name}</p>
      )}
      <p className="text-[10px] text-slate-400 mt-1 truncate">{draft.weekLabel}{draft.dayLabel ? ` · ${draft.dayLabel}` : ""}</p>
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

// ─── Main Kanban ────────────────────────────────────────────────────────────
export default function Kanban({ clients, selectedClientId, onSelectClient, activeProfileId, team, ownerName = "Owner", isClient = false }: Props) {
  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  const [stages, setStages] = useState<WorkflowStage[]>([]);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [drafts, setDrafts] = useState<ScriptDraft[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [activeDraftId, setActiveDraftId] = useState<number | null>(null);
  const [detailDraft, setDetailDraft] = useState<ScriptDraft | null>(null);
  const [rejectDraftData, setRejectDraftData] = useState<ScriptDraft | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showStageManager, setShowStageManager] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const reload = useCallback(async () => {
    if (!selectedClientId) return;
    const [s, co, d, cr] = await Promise.all([
      fetch(`/api/workflow?clientId=${selectedClientId}`).then((r) => r.json()),
      fetch(`/api/concepts?clientId=${selectedClientId}`).then((r) => r.json()),
      fetch(`/api/script-drafts?clientId=${selectedClientId}`).then((r) => r.json()),
      fetch(`/api/creators?clientId=${selectedClientId}`).then((r) => r.json()),
    ]);
    setStages(s);
    setConcepts(co);
    setDrafts(d);
    setCreators(Array.isArray(cr) ? cr : []);
  }, [selectedClientId]);

  useEffect(() => { reload(); }, [reload]);

  // Active profile member
  const activeProfile = team.find((m) => m.id === activeProfileId) ?? null;

  // If logged in as a team member, only show stages assigned to them
  const visibleStages = activeProfile
    ? stages.filter((s) => s.assignedToId === activeProfile.id)
    : stages;
  // Owner sees all stages (no filter)

  const pendingDrafts = drafts.filter((d) => d.status === "pending" && !d.stageId);
  const savedDrafts   = drafts.filter((d) => d.status === "saved");
  const ideaColumn    = [...pendingDrafts, ...savedDrafts];

  function draftsForStage(stageId: number) {
    return drafts.filter((d) => d.stageId === stageId && d.status === "accepted");
  }

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
      setRejectDraftData(draft);
      setDetailDraft(null);
    }
  }

  async function confirmReject(draft: ScriptDraft, reasonType: string, reason: string) {
    // Save feedback before deleting
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
    setRejectDraftData(null);
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
    return idx >= 0 && idx < stages.length - 1 ? stages[idx + 1] : null;
  }

  async function proceedToNextStage(draft: ScriptDraft) {
    if (!draft.stageId) return;
    const next = getNextStage(draft.stageId);
    await moveDraft(draft.id, next?.id ?? null);
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
        </div>
        <div className="flex items-center gap-2">
          {!activeProfile && (
            <button onClick={() => setShowStageManager(true)}
              className="px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50">
              ⚙ Stages
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
                      <DraggableCard draft={draft} onClick={() => setDetailDraft(draft)} />
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
                      const person = stage.assignedToOwner
                        ? { name: "Owner", color: "#6366f1" }
                        : stage.assignedTo ?? stage.assignedCreator ?? null;
                      return person ? (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <div className="w-4 h-4 rounded-full flex-shrink-0 text-[8px] font-bold text-white flex items-center justify-center"
                            style={{ backgroundColor: person.color }}>
                            {person.name[0]}
                          </div>
                          <span className="text-[10px] text-slate-400">{person.name}</span>
                        </div>
                      ) : null;
                    })()}
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-[120px]">
                    {stageDrafts.map((draft) => (
                      <div key={draft.id} className="space-y-1.5">
                        <DraggableCard draft={draft} onClick={() => setDetailDraft(draft)} />
                        {/* Per-card actions for assignees */}
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
          draft={detailDraft}
          language={client.language}
          stages={stages}
          onClose={() => setDetailDraft(null)}
          onAccept={() => { moveDraft(detailDraft.id, stages[0]?.id ?? null); setDetailDraft(null); }}
          onReject={() => rejectDraft(detailDraft.id)}
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
          getNextStage={(id) => getNextStage(id)}
          onUploaded={(urls) => {
            fetch(`/api/script-drafts/${detailDraft.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ rawContentUrls: urls }),
            });
            setDetailDraft((d) => d ? { ...d, rawContentUrls: JSON.stringify(urls) } : null);
            // update the draft in the list without a full reload
            setDrafts((ds) => ds.map((d) => d.id === detailDraft.id ? { ...d, rawContentUrls: JSON.stringify(urls) } : d));
          }}
        />
      )}

      {/* Rejection reason modal */}
      {rejectDraftData && (
        <RejectModal
          draft={rejectDraftData}
          onCancel={() => { setRejectDraftData(null); setDetailDraft(rejectDraftData); }}
          onConfirm={(reasonType, reason) => confirmReject(rejectDraftData, reasonType, reason)}
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

      {/* Stage manager */}
      {showStageManager && (
        <StageManagerModal
          client={client}
          stages={stages}
          team={team}
          creators={creators}
          onClose={() => setShowStageManager(false)}
          onSaved={() => { setShowStageManager(false); reload(); }}
        />
      )}
    </div>
  );
}

// ─── File upload button ─────────────────────────────────────────────────────
function FileUploadButton({ draft, onUploaded }: { draft: ScriptDraft; onUploaded: (urls: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const existing: string[] = JSON.parse(draft.rawContentUrls || "[]");

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setProgress(0);
    try {
      const urls = await Promise.all(
        files.map((f) => upload(f.name, f, {
          access: "public",
          handleUploadUrl: "/api/upload",
          onUploadProgress: ({ percentage }) => setProgress((p) => Math.max(p ?? 0, Math.round(percentage))),
        }).then((b) => b.url))
      );
      onUploaded([...existing, ...urls]);
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="video/*,image/*" multiple className="hidden" onChange={handleFiles} />
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

// ─── Save-as-Idea button ────────────────────────────────────────────────────
function SaveIdeaButton({ draft, interval, onSave }: { draft: ScriptDraft; interval: number; onSave: (weeks: number) => void }) {
  const [open, setOpen] = useState(false);
  const [weeks, setWeeks] = useState(interval);
  if (draft.isSavedIdea) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen((s) => !s)}
        title="Save as idea for later"
        className="px-2 py-1 text-[10px] font-semibold text-amber-600 bg-amber-50 rounded-lg hover:bg-amber-100">
        💡
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-xl p-3 z-50 w-44">
          <p className="text-[10px] font-semibold text-slate-600 mb-2">Resurface in how many weeks?</p>
          <div className="flex items-center gap-2 mb-2">
            <input type="number" min={1} max={52} value={weeks}
              onChange={(e) => setWeeks(parseInt(e.target.value) || 1)}
              className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
            <span className="text-[10px] text-slate-500">weeks</span>
          </div>
          <button onClick={() => { onSave(weeks); setOpen(false); }}
            className="w-full py-1.5 text-[10px] font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600">
            Save idea
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Detail / Refine panel ──────────────────────────────────────────────────
function DraftDetailPanel({
  draft, language, stages, onClose, onAccept, onReject, onSaveAsIdea, onScriptUpdated, onProceed, getNextStage, onUploaded, activeProfileId, ownerName = "Owner", isClient = false,
}: {
  draft: ScriptDraft; language: string; stages: WorkflowStage[];
  onClose: () => void; onAccept: () => void; onReject: () => void;
  onSaveAsIdea: (weeks: number) => void;
  onScriptUpdated: (script: string, hook: string | null) => void;
  onProceed: () => void;
  getNextStage: (stageId: number) => WorkflowStage | null;
  onUploaded: (urls: string[]) => void;
  activeProfileId: number | null;
  ownerName?: string;
  isClient?: boolean;
}) {
  const [script, setScript] = useState(draft.script);
  const [hook, setHook] = useState(draft.hook || "");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [refining, setRefining] = useState(false);
  const [saveWeeks, setSaveWeeks] = useState(2);
  const [notes, setNotes] = useState<{ id: number; author: string; content: string; createdAt: string }[]>([]);
  const [changes, setChanges] = useState<{ id: number; field: string; before: string; after: string; author: string; createdAt: string }[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [prevHook, setPrevHook] = useState(draft.hook || "");
  const [prevScript, setPrevScript] = useState(draft.script);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const inStage = !!draft.stageId;
  const nextStage = draft.stageId ? getNextStage(draft.stageId) : null;
  const authorName = activeProfileId ? "client" : ownerName;

  useEffect(() => {
    fetch(`/api/draft-notes?draftId=${draft.id}`).then(r => r.json()).then(setNotes);
    fetch(`/api/draft-changes?draftId=${draft.id}`).then(r => r.json()).then(setChanges);
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
      <div className="w-[520px] bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between flex-shrink-0">
          <div>
            <p className="text-xs font-semibold text-indigo-500 mb-0.5">{draft.concept?.name}</p>
            <h3 className="text-sm font-bold text-slate-800">{draft.title}</h3>
            <p className="text-[10px] text-slate-400 mt-0.5">{draft.weekLabel}{draft.dayLabel ? ` · ${draft.dayLabel}` : ""}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-4 text-lg leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
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

          {/* Raw content upload — shown when in a stage */}
          {inStage && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Raw Content</label>
              <RawContentUpload draft={draft} onUploaded={onUploaded} />
            </div>
          )}

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
                  <p className="text-xs text-slate-700">{n.content}</p>
                  <p className="text-[10px] text-slate-400 mt-1">{n.author} · {new Date(n.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={noteInput} onChange={(e) => setNoteInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault();
                  if (!noteInput.trim()) return;
                  fetch("/api/draft-notes", { method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ draftId: draft.id, content: noteInput.trim(), author: authorName }) })
                    .then(r => r.json()).then(n => { setNotes(prev => [...prev, n]); setNoteInput(""); });
                }}}
                placeholder="Add a note…"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <button onClick={() => {
                if (!noteInput.trim()) return;
                fetch("/api/draft-notes", { method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ draftId: draft.id, content: noteInput.trim(), author: authorName }) })
                  .then(r => r.json()).then(n => { setNotes(prev => [...prev, n]); setNoteInput(""); });
              }} className="px-3 py-2 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600">Add</button>
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
          {inStage ? (
            <button onClick={onProceed}
              className="w-full py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700">
              {nextStage ? `→ Proceed to ${nextStage.name}` : "✓ Mark as Done"}
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={onAccept}
                className="flex-1 py-2 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600">
                ✓ Accept
              </button>
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

// ─── Raw content upload in detail panel ─────────────────────────────────────
function RawContentUpload({ draft, onUploaded }: { draft: ScriptDraft; onUploaded: (urls: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const urls: string[] = JSON.parse(draft.rawContentUrls || "[]");

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setProgress(0);
    setError("");
    try {
      const newUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const blob = await upload(f.name, f, {
          access: "public",
          handleUploadUrl: "/api/upload",
          onUploadProgress: ({ percentage }) => {
            const overall = ((i / files.length) + percentage / 100 / files.length) * 100;
            setProgress(Math.round(overall));
          },
        });
        newUrls.push(blob.url);
      }
      onUploaded([...urls, ...newUrls]);
    } catch (err) {
      setError(String(err));
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function removeFile(idx: number) {
    onUploaded(urls.filter((_, i) => i !== idx));
  }

  function isVideo(url: string) {
    return /\.(mp4|mov|avi|webm|mkv|m4v)$/i.test(url.split("?")[0]);
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      {urls.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {urls.map((url, i) => (
            <div key={i} className="relative group rounded-xl overflow-hidden bg-slate-900 aspect-square">
              {isVideo(url) ? (
                <video src={url} controls className="w-full h-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={`File ${i + 1}`} className="w-full h-full object-cover" />
              )}
              <button
                onClick={() => removeFile(i)}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
                ✕
              </button>
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="absolute bottom-1.5 left-1.5 text-[9px] bg-black/60 text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                Open ↗
              </a>
            </div>
          ))}
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
            <div className="bg-indigo-500 h-1.5 rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full py-2 text-sm font-medium border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
          ⬆ Add files
        </button>
      )}
    </div>
  );
}

// ─── Generate scripts modal ─────────────────────────────────────────────────
function GenerateModal({ client, concepts, onClose, onGenerated }: {
  client: Client; concepts: Concept[]; onClose: () => void; onGenerated: () => void;
}) {
  const [selectedConcepts, setSelectedConcepts] = useState<number[]>(concepts.map((c) => c.id));
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
              <button onClick={() => setSelectedConcepts(selectedConcepts.length === concepts.length ? [] : concepts.map((c) => c.id))}
                className="text-xs text-indigo-600 hover:underline">
                {selectedConcepts.length === concepts.length ? "Deselect all" : "Select all"}
              </button>
            </div>
            {concepts.length === 0 ? (
              <p className="text-xs text-slate-400">No concepts yet — add some in the Concept Library first.</p>
            ) : (
              <div className="space-y-1.5">
                {concepts.map((c) => (
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
                    {c.name}
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

// ─── Stage manager modal ────────────────────────────────────────────────────
type PersonValue = "" | "owner" | `member:${number}` | `creator:${number}`;

function stageToPersonValue(s: WorkflowStage): PersonValue {
  if (s.assignedToOwner) return "owner";
  if (s.assignedToId) return `member:${s.assignedToId}`;
  if (s.assignedCreatorId) return `creator:${s.assignedCreatorId}`;
  return "";
}

function personValueToFields(v: PersonValue) {
  if (v === "owner") return { assignedToOwner: true, assignedToId: null, assignedCreatorId: null };
  if (v.startsWith("member:")) return { assignedToOwner: false, assignedToId: parseInt(v.slice(7)), assignedCreatorId: null };
  if (v.startsWith("creator:")) return { assignedToOwner: false, assignedToId: null, assignedCreatorId: parseInt(v.slice(8)) };
  return { assignedToOwner: false, assignedToId: null, assignedCreatorId: null };
}

function StageManagerModal({ client, stages, team, creators, onClose, onSaved }: {
  client: Client; stages: WorkflowStage[]; team: TeamMember[]; creators: Creator[];
  onClose: () => void; onSaved: () => void;
}) {
  const [list, setList] = useState(stages);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [newPerson, setNewPerson] = useState<PersonValue>("");
  const COLORS = ["#6366f1","#8b5cf6","#ec4899","#ef4444","#f97316","#eab308","#22c55e","#14b8a6","#3b82f6"];

  async function save(updated: WorkflowStage[]) {
    setList(updated);
    await fetch("/api/workflow", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: client.id, stages: updated }),
    });
  }

  async function addStage() {
    if (!newName.trim()) return;
    const fields = personValueToFields(newPerson);
    const res = await fetch("/api/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: client.id, name: newName.trim(), color: newColor, ...fields }),
    });
    const stage = await res.json();
    setList((l) => [...l, stage]);
    setNewName("");
    setNewPerson("");
  }

  async function deleteStage(id: number) {
    await fetch(`/api/workflow/${id}`, { method: "DELETE" });
    setList((l) => l.filter((s) => s.id !== id));
  }

  async function updateAssignee(stageId: number, v: PersonValue) {
    const fields = personValueToFields(v);
    const updated = list.map((s) => s.id === stageId ? { ...s, ...fields } : s);
    await save(updated);
  }

  async function reorder(from: number, to: number) {
    const updated = [...list];
    const [item] = updated.splice(from, 1);
    updated.splice(to, 0, item);
    await save(updated.map((s, i) => ({ ...s, order: i + 1 })));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-[500px] max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">⚙ Stages · {client.name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">×</button>
        </div>
        <div className="px-6 py-5 space-y-2">
          {list.map((stage, i) => (
            <div key={stage.id} className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-xl">
              <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: stage.color }} />
              <span className="text-sm text-slate-700 font-medium w-24 truncate">{stage.name}</span>
              <select
                value={stageToPersonValue(stage)}
                onChange={(e) => updateAssignee(stage.id, e.target.value as PersonValue)}
                className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white text-slate-600">
                <option value="">Unassigned</option>
                <option value="owner">👑 Owner</option>
                {team.length > 0 && <option disabled>── Team ──</option>}
                {team.map((m) => <option key={m.id} value={`member:${m.id}`}>{m.name}</option>)}
                {creators.length > 0 && <option disabled>── Creators ──</option>}
                {creators.map((c) => <option key={c.id} value={`creator:${c.id}`}>{c.name}</option>)}
              </select>
              <button onClick={() => i > 0 && reorder(i, i - 1)} disabled={i === 0}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-30 text-xs px-1">↑</button>
              <button onClick={() => i < list.length - 1 && reorder(i, i + 1)} disabled={i === list.length - 1}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-30 text-xs px-1">↓</button>
              <button onClick={() => deleteStage(stage.id)}
                className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>
            </div>
          ))}

          <div className="pt-3 border-t border-slate-100 space-y-2">
            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setNewColor(c)}
                  className={`w-5 h-5 rounded-full flex-shrink-0 transition-transform ${newColor === c ? "scale-125 ring-2 ring-offset-1 ring-slate-400" : ""}`}
                  style={{ backgroundColor: c }} />
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addStage()}
                placeholder="Stage name…"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <select value={newPerson} onChange={(e) => setNewPerson(e.target.value as PersonValue)}
                className="border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-slate-600">
                <option value="">Unassigned</option>
                <option value="owner">👑 Owner</option>
                {team.length > 0 && <option disabled>── Team ──</option>}
                {team.map((m) => <option key={m.id} value={`member:${m.id}`}>{m.name}</option>)}
                {creators.length > 0 && <option disabled>── Creators ──</option>}
                {creators.map((c) => <option key={c.id} value={`creator:${c.id}`}>{c.name}</option>)}
              </select>
              <button onClick={addStage} disabled={!newName.trim()}
                className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                Add
              </button>
            </div>
          </div>
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
  draft, onCancel, onConfirm,
}: {
  draft: ScriptDraft;
  onCancel: () => void;
  onConfirm: (reasonType: string, reason: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");

  function handleConfirm() {
    if (!selected) return;
    onConfirm(selected, selected === "custom" ? customText : "");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="text-base font-bold text-slate-800">Why are you rejecting this?</h2>
          <p className="text-xs text-slate-400 mt-0.5 truncate">"{draft.title}"</p>
          <p className="text-[10px] text-indigo-500 mt-0.5">Claude will learn from this for future scripts on this concept.</p>
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
            ✗ Reject & Delete
          </button>
        </div>
      </div>
    </div>
  );
}
