"use client";

import { useEffect, useState } from "react";
import { Client, Concept, HOOK_TYPE_SUGGESTIONS, VIDEO_TYPE_SUGGESTIONS } from "@/lib/types";
import Modal from "@/components/ui/Modal";

type Props = { clients: Client[]; selectedClientId: number | null; refreshClients: () => void };

export default function Concepts({ clients, selectedClientId }: Props) {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Concept | null>(null);

  useEffect(() => {
    reload();
  }, [selectedClientId]);

  async function reload() {
    const qs = selectedClientId ? `?clientId=${selectedClientId}` : "";
    const data = await fetch(`/api/concepts${qs}`).then((r) => r.json());
    setConcepts(data);
  }

  async function deleteConcept(id: number) {
    if (!confirm("Delete this concept?")) return;
    await fetch(`/api/concepts/${id}`, { method: "DELETE" });
    setSelected(null);
    reload();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Concept Library</h1>
          <p className="text-slate-500 mt-1">The viral playbook — your winning content DNA</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          + New Concept
        </button>
      </div>

      {concepts.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-4xl mb-3">💡</div>
          <p className="text-slate-500">No concepts yet. When a video goes viral, capture why it worked here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {concepts.map((concept) => (
            <button
              key={concept.id}
              onClick={() => setSelected(concept)}
              className="bg-white rounded-xl border border-slate-200 p-5 text-left hover:shadow-md hover:border-indigo-200 transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-slate-800 text-sm">{concept.name}</h3>
                <span className="text-xs text-slate-400 flex-shrink-0 ml-2">×{concept.timesUsed}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {concept.hookType && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                    🎣 {concept.hookType}
                  </span>
                )}
                {concept.videoType && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                    🎬 {concept.videoType}
                  </span>
                )}
                {concept.angle && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                    {concept.angle}
                  </span>
                )}
                {concept.client && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: concept.client.color }}>
                    {concept.client.name}
                  </span>
                )}
              </div>
              {concept.textHook && (
                <p className="text-xs text-slate-500 italic mb-2 truncate">"{concept.textHook}"</p>
              )}
              {concept.guidelines && (
                <p className="text-xs text-slate-400 line-clamp-2">{concept.guidelines}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {showAdd && (
        <ConceptModal
          clients={clients}
          selectedClientId={selectedClientId}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); reload(); }}
        />
      )}

      {selected && (
        <ConceptDetailModal
          concept={selected}
          onClose={() => setSelected(null)}
          onDelete={() => deleteConcept(selected.id)}
        />
      )}
    </div>
  );
}

function ConceptModal({
  clients, selectedClientId, onClose, onSaved,
}: {
  clients: Client[];
  selectedClientId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const activeClient = clients.find((c) => c.id === selectedClientId) ?? null;

  const [form, setForm] = useState({
    name: "", clientId: selectedClientId?.toString() || "",
    hookType: "", textHook: "", audioHook: "", videoType: "",
    angle: "", structure: "", guidelines: "", exampleUrl: "", scriptExamples: "", notes: "",
  });

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/concepts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    onSaved();
  }

  return (
    <Modal title="New Concept" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {/* Client context banner or selector */}
        {activeClient ? (
          <div
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
            style={{ backgroundColor: activeClient.color + "15", border: `1.5px solid ${activeClient.color}30` }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
              style={{ backgroundColor: activeClient.color }}
            >
              {activeClient.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">{activeClient.name}</p>
              <p className="text-xs text-slate-500 capitalize">{activeClient.platform}</p>
            </div>
            <span className="text-[10px] text-slate-400">concept for this client</span>
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Client (optional — blank = global)</label>
            <select value={form.clientId} onChange={(e) => set("clientId", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="">Global (all clients)</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Concept Name *</label>
          <input required value={form.name} onChange={(e) => set("name", e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>

        {/* CRITICAL: datalist inputs for hookType and videoType */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Hook Type (free text)</label>
            <input
              list="hookTypeList"
              value={form.hookType}
              onChange={(e) => set("hookType", e.target.value)}
              placeholder="e.g. question, curiosity_gap..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <datalist id="hookTypeList">
              {HOOK_TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Video Type (free text)</label>
            <input
              list="videoTypeList"
              value={form.videoType}
              onChange={(e) => set("videoType", e.target.value)}
              placeholder="e.g. talking_head, broll..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <datalist id="videoTypeList">
              {VIDEO_TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Text Hook Template</label>
          <input value={form.textHook} onChange={(e) => set("textHook", e.target.value)}
            placeholder='e.g. "Did you know that [fact]..."'
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Audio Hook</label>
            <input value={form.audioHook} onChange={(e) => set("audioHook", e.target.value)}
              placeholder="Description of audio approach..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Angle</label>
            <input value={form.angle} onChange={(e) => set("angle", e.target.value)}
              placeholder="The perspective or approach..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Structure</label>
          <textarea rows={2} value={form.structure} onChange={(e) => set("structure", e.target.value)}
            placeholder='e.g. "Hook (3s) → Problem (5s) → Solution (10s) → CTA (3s)"'
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Guidelines</label>
          <textarea rows={3} value={form.guidelines} onChange={(e) => set("guidelines", e.target.value)}
            placeholder="Pacing, cut changes, energy level, what to include/avoid..."
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Script Examples
            <span className="ml-1.5 text-[10px] font-normal text-slate-400">Paste 1–3 real scripts that worked well — the AI uses these as its primary reference</span>
          </label>
          <textarea rows={6} value={form.scriptExamples} onChange={(e) => set("scriptExamples", e.target.value)}
            placeholder={"Example script 1:\n---\nHook: Did you know most people waste their first 3 seconds?\n[Script body here...]\n\n---\nExample script 2:\n[Another working script...]"}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Example URL</label>
            <input type="url" value={form.exampleUrl} onChange={(e) => set("exampleUrl", e.target.value)}
              placeholder="Link to reference video..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <input value={form.notes} onChange={(e) => set("notes", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button type="submit" className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Save Concept</button>
        </div>
      </form>
    </Modal>
  );
}

function ConceptDetailModal({ concept, onClose, onDelete }: { concept: Concept; onClose: () => void; onDelete: () => void }) {
  return (
    <Modal title={concept.name} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {concept.hookType && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
              🎣 {concept.hookType}
            </span>
          )}
          {concept.videoType && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
              🎬 {concept.videoType}
            </span>
          )}
          {concept.angle && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
              {concept.angle}
            </span>
          )}
          {concept.client && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: concept.client.color }}>
              {concept.client.name}
            </span>
          )}
          {!concept.clientId && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
              Global
            </span>
          )}
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            Used {concept.timesUsed}×
          </span>
        </div>

        {concept.textHook && (
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">TEXT HOOK</p>
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 text-sm font-medium text-indigo-800">
              {concept.textHook}
            </div>
          </div>
        )}

        {concept.audioHook && (
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">AUDIO HOOK</p>
            <p className="text-sm text-slate-600">{concept.audioHook}</p>
          </div>
        )}

        {concept.structure && (
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">STRUCTURE</p>
            <pre className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm font-mono whitespace-pre-wrap text-slate-700">
              {concept.structure}
            </pre>
          </div>
        )}

        {concept.guidelines && (
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">GUIDELINES</p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-700">
              {concept.guidelines}
            </div>
          </div>
        )}

        {concept.scriptExamples && (
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">SCRIPT EXAMPLES</p>
            <pre className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm font-mono whitespace-pre-wrap text-slate-700 max-h-64 overflow-y-auto">
              {concept.scriptExamples}
            </pre>
          </div>
        )}

        {concept.exampleUrl && (
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">EXAMPLE</p>
            <a href={concept.exampleUrl} target="_blank" rel="noopener noreferrer"
              className="text-sm text-indigo-600 hover:underline break-all">{concept.exampleUrl}</a>
          </div>
        )}

        {concept.notes && (
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">NOTES</p>
            <p className="text-sm text-slate-600">{concept.notes}</p>
          </div>
        )}

        <div className="flex justify-between pt-2 border-t border-slate-100">
          <button onClick={onDelete} className="text-sm text-red-500 hover:text-red-700">Delete</button>
          <button onClick={onClose} className="px-4 py-2 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200">Close</button>
        </div>
      </div>
    </Modal>
  );
}
