"use client";

import { useEffect, useState } from "react";
import { WorkflowStage, TeamMember, MEMBER_COLORS } from "@/lib/types";
import Modal from "@/components/ui/Modal";

export default function WorkflowPage() {
  const [stages, setStages] = useState<WorkflowStage[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<WorkflowStage | null>(null);

  useEffect(() => { reload(); }, []);

  async function reload() {
    const [s, t] = await Promise.all([
      fetch("/api/workflow").then((r) => r.json()),
      fetch("/api/team").then((r) => r.json()),
    ]);
    setStages(s);
    setTeam(t);
  }

  async function deleteStage(id: number) {
    if (!confirm("Delete this stage?")) return;
    await fetch(`/api/workflow/${id}`, { method: "DELETE" });
    reload();
  }

  async function moveStage(index: number, dir: -1 | 1) {
    const newStages = [...stages];
    const swap = index + dir;
    if (swap < 0 || swap >= newStages.length) return;
    [newStages[index], newStages[swap]] = [newStages[swap], newStages[index]];
    const updated = newStages.map((s, i) => ({ ...s, order: i + 1 }));
    setStages(updated);
    await fetch("/api/workflow", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stages: updated }),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Workflow Stages</h1>
          <p className="text-slate-500 text-sm mt-0.5">Define your team's content production pipeline</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700">
          + Add Stage
        </button>
      </div>

      {/* Visual pipeline preview */}
      {stages.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-400 mb-4 uppercase tracking-wide">Pipeline Preview</p>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {stages.map((stage, i) => (
              <div key={stage.id} className="flex items-center gap-2 flex-shrink-0">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-lg mb-1.5"
                    style={{ backgroundColor: stage.color }}>
                    {i + 1}
                  </div>
                  <p className="text-xs font-semibold text-slate-700 max-w-[64px] text-center leading-tight">{stage.name}</p>
                  {stage.assignedTo && (
                    <p className="text-[10px] text-slate-400 mt-0.5">{stage.assignedTo.name}</p>
                  )}
                </div>
                {i < stages.length - 1 && (
                  <div className="text-slate-300 text-xl flex-shrink-0">→</div>
                )}
              </div>
            ))}
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="text-slate-300 text-xl">→</div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-green-500 flex items-center justify-center text-white text-xl mb-1.5">✓</div>
                <p className="text-xs font-semibold text-green-600">Posted</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stage list */}
      {stages.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-14 text-center">
          <div className="text-4xl mb-3">⚙️</div>
          <p className="text-slate-500 text-sm mb-2">No workflow stages yet.</p>
          <p className="text-slate-400 text-xs mb-4">
            Example: <span className="font-medium">SMM scripts it</span> → <span className="font-medium">Creator films it</span> → <span className="font-medium">Editor finishes it</span> → <span className="font-medium">SMM approves it</span>
          </p>
          <button onClick={() => setShowAdd(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700">
            + Add First Stage
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {stages.map((stage, i) => (
            <div key={stage.id} className="bg-white rounded-xl border border-slate-200 flex items-center gap-4 px-5 py-4">
              {/* Order indicator */}
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                style={{ backgroundColor: stage.color }}>
                {i + 1}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800">{stage.name}</p>
                {stage.assignedTo ? (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ backgroundColor: stage.assignedTo.color }} />
                    <p className="text-xs text-slate-500">{stage.assignedTo.name}{stage.assignedTo.role ? ` · ${stage.assignedTo.role}` : ""}</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mt-0.5">No one assigned</p>
                )}
              </div>

              {/* Notification indicator */}
              {stage.assignedTo && (
                <div className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-full">
                  🔔 Notifies {stage.assignedTo.name}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button onClick={() => moveStage(i, -1)} disabled={i === 0}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 disabled:opacity-30 text-sm">
                  ↑
                </button>
                <button onClick={() => moveStage(i, 1)} disabled={i === stages.length - 1}
                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 disabled:opacity-30 text-sm">
                  ↓
                </button>
                <button onClick={() => setEditing(stage)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 ml-1">
                  Edit
                </button>
                <button onClick={() => deleteStage(stage.id)}
                  className="px-3 py-1.5 text-xs font-medium text-red-500 bg-red-50 rounded-lg hover:bg-red-100">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <StageModal team={team} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); reload(); }} />}
      {editing && <StageModal stage={editing} team={team} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function StageModal({ stage, team, onClose, onSaved }: {
  stage?: WorkflowStage;
  team: TeamMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: stage?.name || "",
    color: stage?.color || "#6366f1",
    assignedToId: stage?.assignedToId?.toString() || "",
  });
  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (stage) {
      await fetch(`/api/workflow/${stage.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } else {
      await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    }
    onSaved();
  }

  return (
    <Modal title={stage ? "Edit Stage" : "New Workflow Stage"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Stage Name *</label>
          <input required value={form.name} onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. SMM Scripts, Creator Films, Editor Edits, SMM Approves..."
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Assigned To (gets notified when content reaches this stage)</label>
          {team.length === 0 ? (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              No team members yet. Add team members first to assign them to stages.
            </p>
          ) : (
            <select value={form.assignedToId} onChange={(e) => set("assignedToId", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">— No one assigned —</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name}{m.role ? ` (${m.role})` : ""}</option>)}
            </select>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-2">Stage Color</label>
          <div className="flex flex-wrap gap-2">
            {MEMBER_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => set("color", c)}
                className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? "ring-2 ring-offset-2 ring-slate-400 scale-110" : ""}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>

        {form.name && (
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: form.color }}>
              {stage ? "→" : "+"}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">{form.name}</p>
              <p className="text-xs text-slate-400">
                {form.assignedToId
                  ? `Notifies ${team.find((m) => m.id === parseInt(form.assignedToId))?.name}`
                  : "No notification"}
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-xl hover:bg-indigo-700">
            {stage ? "Save Changes" : "Add Stage"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
