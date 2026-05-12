"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Client, Concept, WorkflowStage, ScriptDraft, TeamMember, Creator } from "@/lib/types";
import { QRCodeSVG } from "qrcode.react";

type Props = {
  clients: Client[];
  selectedClientId: number | null;
  onSelectClient: (id: number | null) => void;
  activeProfileId: number | null;
  activeProfile: TeamMember | null;
  team: TeamMember[];
  ownerName?: string;
  isClient?: boolean;
  onOpenChat?: (context: { id?: number; title: string; hook?: string | null; script: string; caption?: string | null }) => void;
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
export default function Kanban({ clients, selectedClientId, onSelectClient, activeProfileId, activeProfile, team, ownerName = "Owner", isClient = false, onOpenChat }: Props) {
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

  // Clients see their whole kanban; team members only see stages assigned to them
  // Also show stages assigned to "client" since client logins are team members too
  const visibleStages = activeProfile
    ? activeProfile.isClientAccount
      ? stages
      : stages.filter((s) => {
          const assignees = getStageAssignees(s);
          return assignees.includes(`member:${activeProfile.id}`) || assignees.includes("client");
        })
    : stages;

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
              ⚙ Assign Stages
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
                        <DraggableCard draft={draft} onClick={() => setDetailDraft(draft)} />
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
                              → Check
                            </button>
                          </div>
                        ) : stage.name === "Check" ? (
                          <CheckCardActions draft={draft} onProceed={() => proceedToNextStage(draft)} />
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
          onReviewSubmitted={() => reload()}
          team={team}
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
          ownerName={ownerName}
          onClose={() => setShowStageManager(false)}
          onSaved={() => { setShowStageManager(false); reload(); }}
        />
      )}
    </div>
  );
}

// ─── Cloudinary upload helper ────────────────────────────────────────────────
function cloudinaryUpload(file: File, onProgress: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME!;
    const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!;
    const resourceType = file.type.startsWith("video") ? "video" : "image";
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", preset);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloud}/${resourceType}/upload`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText).secure_url);
      else reject(new Error(JSON.parse(xhr.responseText).error?.message ?? "Upload failed"));
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
  });
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
  draft, language, stages, team, onClose, onAccept, onReject, onSaveAsIdea, onScriptUpdated, onProceed, getNextStage, onUploaded, onEditedVideoUploaded, onReviewSubmitted, activeProfileId, ownerName = "Owner", isClient = false, onOpenChat,
}: {
  draft: ScriptDraft; language: string; stages: WorkflowStage[]; team: TeamMember[];
  onClose: () => void; onAccept: () => void; onReject: () => void;
  onSaveAsIdea: (weeks: number) => void;
  onScriptUpdated: (script: string, hook: string | null) => void;
  onProceed: () => void;
  getNextStage: (stageId: number) => WorkflowStage | null;
  onUploaded: (urls: string[]) => void;
  onEditedVideoUploaded: (url: string) => void;
  onReviewSubmitted: () => void;
  activeProfileId: number | null;
  ownerName?: string;
  isClient?: boolean;
  onOpenChat?: (context: { id?: number; title: string; hook?: string | null; script: string; caption?: string | null }) => void;
}) {
  const [script, setScript] = useState(draft.script);
  const [hook, setHook] = useState(draft.hook || "");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [refining, setRefining] = useState(false);
  const [saveWeeks, setSaveWeeks] = useState(2);
  const [checkApproved, setCheckApproved] = useState(false);
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

          {/* Raw content — hidden on Check stage */}
          {inStage && stages.find((s) => s.id === draft.stageId)?.name !== "Check" && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Raw Content</label>
              <RawContentUpload draft={draft} onUploaded={onUploaded} />
            </div>
          )}

          {/* Finished video — shown on Edit stage (upload) and Check stage (view only) */}
          {inStage && (stages.find((s) => s.id === draft.stageId)?.name === "Edit" || stages.find((s) => s.id === draft.stageId)?.name === "Check") && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Finished Video</label>
              {stages.find((s) => s.id === draft.stageId)?.name === "Check" ? (
                draft.editedVideoUrl ? (
                  <div className="rounded-xl overflow-hidden bg-slate-900 aspect-video">
                    <video src={draft.editedVideoUrl} controls className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No finished video uploaded yet.</p>
                )
              ) : (
                <FinishedVideoUpload draft={draft} onUploaded={onEditedVideoUploaded} />
              )}
            </div>
          )}

          {/* Review panel — Check stage only */}
          {inStage && stages.find((s) => s.id === draft.stageId)?.name === "Check" && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Reviews</label>
              <ReviewPanel draft={draft} team={team} ownerName={ownerName} onReviewSubmitted={onReviewSubmitted} onApprovalChange={setCheckApproved} />
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
          {onOpenChat && (
            <button
              onClick={() => onOpenChat({ id: draft.id, title: draft.title, hook: draft.hook, script: draft.script, caption: draft.caption })}
              className="w-full py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors flex items-center justify-center gap-2"
            >
              💬 Talk about this reel
            </button>
          )}
          {inStage ? (() => {
            const isCheck = stages.find((s) => s.id === draft.stageId)?.name === "Check";
            const canProceed = !isCheck || checkApproved;
            return (
              <button onClick={onProceed} disabled={!canProceed}
                title={!canProceed ? "Waiting for all reviewers to approve" : ""}
                className={`w-full py-2.5 text-sm font-semibold text-white rounded-xl transition-colors ${
                  canProceed ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-300 cursor-not-allowed"
                }`}>
                {nextStage ? `→ Proceed to ${nextStage.name}` : "✓ Mark as Done"}
              </button>
            );
          })() : (
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
function FinishedVideoUpload({ draft, onUploaded }: { draft: ScriptDraft; onUploaded: (url: string) => void }) {
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
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full py-2 text-sm font-medium border-2 border-dashed border-orange-300 rounded-lg text-orange-500 hover:border-orange-400 hover:text-orange-600 transition-colors">
          {draft.editedVideoUrl ? "⬆ Replace finished video" : "⬆ Add finished video"}
        </button>
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
  const urls: string[] = JSON.parse(draft.rawContentUrls || "[]");

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setProgress(0);
    setError("");
    try {
      const newUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const url = await cloudinaryUpload(files[i], (pct) => {
          const overall = ((i / files.length) + pct / 100 / files.length) * 100;
          setProgress(Math.round(overall));
        });
        newUrls.push(url);
      }
      onUploaded([...urls, ...newUrls]);
      setExpanded(true);
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

  async function downloadAll() {
    for (const url of urls) {
      const a = document.createElement("a");
      a.href = url;
      a.download = url.split("/").pop() || "file";
      a.target = "_blank";
      a.click();
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return (
    <div className="space-y-2">
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
                    <video src={url} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeFile(i)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
                      ✕
                    </button>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      className="absolute bottom-1 left-1 text-[8px] bg-black/60 text-white px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                      ↗
                    </a>
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
            className="flex-1 py-2 text-sm font-medium border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors">
            ⬆ Add files
          </button>
          <button
            onClick={() => setShowQR(true)}
            title="Generate QR code to upload from phone"
            className="px-3 py-2 text-sm border-2 border-dashed border-slate-300 rounded-lg text-slate-500 hover:border-purple-400 hover:text-purple-600 transition-colors">
            📱 QR
          </button>
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
function StageManagerModal({ client, stages, team, creators, ownerName, onClose, onSaved }: {
  client: Client; stages: WorkflowStage[]; team: TeamMember[]; creators: Creator[]; ownerName: string;
  onClose: () => void; onSaved: () => void;
}) {
  const [list, setList] = useState(stages.map((s) => ({ ...s, _assignees: getStageAssignees(s) })));

  const allPeople: { value: PersonValue; label: string; color: string }[] = [
    { value: "owner", label: ownerName, color: "#6366f1" },
    { value: "client", label: client.name, color: client.color },
    ...team.map((m) => ({ value: `member:${m.id}` as PersonValue, label: m.name, color: m.color })),
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
