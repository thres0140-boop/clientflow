"use client";

import { useEffect, useState } from "react";
import { Client, Concept, HOOK_TYPE_SUGGESTIONS, VIDEO_TYPE_SUGGESTIONS } from "@/lib/types";
import Modal from "@/components/ui/Modal";

type Props = { clients: Client[]; selectedClientId: number | null; refreshClients: () => void };
type Tab = "ideas" | "concepts";

export default function Concepts({ clients, selectedClientId }: Props) {
  const [tab, setTab] = useState<Tab>("ideas");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Concept | null>(null);
  const [promotingIdea, setPromotingIdea] = useState<Concept | null>(null);

  useEffect(() => { reload(); }, [selectedClientId]);

  async function reload() {
    const qs = selectedClientId ? `?clientId=${selectedClientId}` : "";
    const data = await fetch(`/api/concepts${qs}`).then((r) => r.json());
    setConcepts(Array.isArray(data) ? data : []);
  }

  async function deleteConcept(id: number) {
    if (!confirm("Delete this concept?")) return;
    await fetch(`/api/concepts/${id}`, { method: "DELETE" });
    setSelected(null);
    setPromotingIdea(null);
    reload();
  }

  const ideas = concepts.filter((c) => c.isIdea);
  const realConcepts = concepts.filter((c) => !c.isIdea);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Concept Library</h1>
          <p className="text-slate-500 mt-1">The viral playbook — your winning content DNA</p>
        </div>
        {tab === "concepts" && (
          <button
            onClick={() => setShowAdd(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            + New Concept
          </button>
        )}
      </div>

      <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
        {([
          ["ideas", `💡 Ideas${ideas.length > 0 ? ` (${ideas.length})` : ""}`],
          ["concepts", `🧠 Concepts${realConcepts.length > 0 ? ` (${realConcepts.length})` : ""}`],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === id ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "ideas" && (
        <>
          {ideas.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <div className="text-4xl mb-3">💡</div>
              <p className="text-slate-500 font-medium">No concept ideas yet.</p>
              <p className="text-xs text-slate-400 mt-1">
                Go to Instagram → open a reel → click "Save as Concept Idea"
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {ideas.map((idea) => (
                <IdeaCard key={idea.id} idea={idea} onClick={() => setPromotingIdea(idea)} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === "concepts" && (
        <>
          {realConcepts.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <div className="text-4xl mb-3">🧠</div>
              <p className="text-slate-500">No concepts yet. Promote an idea or create one manually.</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {realConcepts.map((concept) => (
                <button
                  key={concept.id}
                  onClick={() => setSelected(concept)}
                  className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors group"
                >
                  {/* Color dot */}
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
                    style={{ backgroundColor: concept.client?.color || "#6366f1" }}
                  >
                    {concept.name[0]}
                  </div>

                  {/* Name + hook */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{concept.name}</p>
                    {concept.textHook && (
                      <p className="text-xs text-slate-400 italic truncate mt-0.5">"{concept.textHook}"</p>
                    )}
                  </div>

                  {/* Tags */}
                  <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                    {concept.hookType && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                        {concept.hookType}
                      </span>
                    )}
                    {concept.videoType && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">
                        {concept.videoType}
                      </span>
                    )}
                    {concept.angle && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        {concept.angle}
                      </span>
                    )}
                  </div>

                  {/* Used count */}
                  <span className="text-xs text-slate-300 flex-shrink-0 ml-2">×{concept.timesUsed}</span>
                  <svg className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-400 flex-shrink-0" viewBox="0 0 16 16" fill="none">
                    <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              ))}
            </div>
          )}
        </>
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

      {promotingIdea && (
        <IdeaDetailPanel
          idea={promotingIdea}
          clients={clients}
          onClose={() => setPromotingIdea(null)}
          onDelete={() => deleteConcept(promotingIdea.id)}
          onPromoted={() => { setPromotingIdea(null); reload(); setTab("concepts"); }}
        />
      )}
    </div>
  );
}

function IdeaCard({ idea, onClick }: { idea: Concept; onClick: () => void }) {
  const hasTranscript = !!(idea.scriptExamples?.trim());
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors group"
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
        style={{ backgroundColor: idea.client?.color || "#8b5cf6" }}
      >
        {idea.name[0]}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{idea.name}</p>
        {idea.notes && (
          <p className="text-xs text-slate-400 truncate mt-0.5">{idea.notes}</p>
        )}
      </div>

      <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
        {idea.client && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full text-white"
            style={{ backgroundColor: idea.client.color }}>
            {idea.client.name}
          </span>
        )}
        {hasTranscript && (
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">transcript</span>
        )}
      </div>

      <svg className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-400 flex-shrink-0" viewBox="0 0 16 16" fill="none">
        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

function IdeaDetailPanel({ idea, clients, onClose, onDelete, onPromoted }: {
  idea: Concept;
  clients: Client[];
  onClose: () => void;
  onDelete: () => void;
  onPromoted: () => void;
}) {
  const [form, setForm] = useState({
    name: idea.name || "",
    conceptType: "",
    hookType: "",
    textHook: "",
    audioHook: "",
    videoType: "",
    angle: "",
    structure: "",
    guidelines: "",
  });
  const [promoting, setPromoting] = useState(false);
  const [generatingGuidelines, setGeneratingGuidelines] = useState(false);
  const [generatingStructure, setGeneratingStructure] = useState(false);

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function generateGuidelines() {
    if (!idea.scriptExamples?.trim()) return;
    setGeneratingGuidelines(true);
    try {
      const data = await fetch("/api/ai/generate-guidelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: idea.scriptExamples, conceptName: form.name }),
      }).then((r) => r.json());
      if (data.guidelines) set("guidelines", data.guidelines);
    } finally {
      setGeneratingGuidelines(false);
    }
  }

  async function generateStructure() {
    if (!idea.scriptExamples?.trim()) return;
    setGeneratingStructure(true);
    try {
      const data = await fetch("/api/ai/generate-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: idea.scriptExamples, conceptName: form.name }),
      }).then((r) => r.json());
      if (data.structure) set("structure", data.structure);
    } finally {
      setGeneratingStructure(false);
    }
  }

  async function promote(e: React.FormEvent) {
    e.preventDefault();
    setPromoting(true);
    await fetch(`/api/concepts/${idea.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        clientId: idea.clientId,
        exampleUrl: idea.exampleUrl,
        scriptExamples: idea.scriptExamples,
        notes: idea.notes,
        isIdea: false,
      }),
    });
    setPromoting(false);
    onPromoted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40" onClick={onClose}>
      <div className="w-[560px] h-full bg-white flex flex-col shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <p className="text-sm font-bold text-slate-800">Concept Idea</p>
            <p className="text-[11px] text-slate-400">Fill in the details to promote to a full concept</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Source info */}
          <div className="px-5 pt-4 pb-3 bg-slate-50 border-b border-slate-100">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">From Instagram</p>
            <p className="text-sm text-slate-700 font-medium line-clamp-2 mb-1">{idea.name}</p>
            {idea.notes && <p className="text-xs text-slate-400">{idea.notes}</p>}
            {idea.exampleUrl && (
              <a href={idea.exampleUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-indigo-500 hover:underline mt-1 inline-block">
                View reel ↗
              </a>
            )}
          </div>

          {idea.scriptExamples && (
            <div className="px-5 py-4 border-b border-slate-100">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Transcript</p>
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-sm text-slate-700 leading-relaxed max-h-36 overflow-y-auto">
                {idea.scriptExamples}
              </div>
            </div>
          )}

          <form id="promoteForm" onSubmit={promote} className="px-5 py-4 space-y-4">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Concept Details</p>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Concept Name *</label>
              <input required value={form.name} onChange={(e) => set("name", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-2">Concept Type</label>
              <div className="flex gap-2 flex-wrap">
                {["Viral", "Trust", "Authentic", "Value"].map((t) => (
                  <button key={t} type="button" onClick={() => set("conceptType", form.conceptType === t ? "" : t)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      form.conceptType === t
                        ? t === "Viral" ? "bg-pink-500 text-white border-pink-500"
                          : t === "Trust" ? "bg-blue-500 text-white border-blue-500"
                          : t === "Authentic" ? "bg-amber-500 text-white border-amber-500"
                          : "bg-green-500 text-white border-green-500"
                        : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                    }`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Hook Type</label>
                <input list="hookTypeListIdea" value={form.hookType} onChange={(e) => set("hookType", e.target.value)}
                  placeholder="e.g. curiosity_gap"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <datalist id="hookTypeListIdea">
                  {HOOK_TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Video Type</label>
                <input list="videoTypeListIdea" value={form.videoType} onChange={(e) => set("videoType", e.target.value)}
                  placeholder="e.g. talking_head"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                <datalist id="videoTypeListIdea">
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Audio Hook</label>
                <input value={form.audioHook} onChange={(e) => set("audioHook", e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Angle</label>
                <input value={form.angle} onChange={(e) => set("angle", e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-600">Structure</label>
                {idea.scriptExamples?.trim() && (
                  <button type="button" onClick={generateStructure} disabled={generatingStructure}
                    className="text-[11px] px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 disabled:opacity-50 transition-colors font-medium">
                    {generatingStructure ? "Generating…" : "✨ AI Generate"}
                  </button>
                )}
              </div>
              <textarea rows={2} value={form.structure} onChange={(e) => set("structure", e.target.value)}
                placeholder='e.g. "Hook (3s) → Problem (5s) → Solution (10s) → CTA (3s)"'
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-600">Guidelines</label>
                {idea.scriptExamples?.trim() && (
                  <button type="button" onClick={generateGuidelines} disabled={generatingGuidelines}
                    className="text-[11px] px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 disabled:opacity-50 transition-colors font-medium">
                    {generatingGuidelines ? "Generating…" : "✨ AI Generate"}
                  </button>
                )}
              </div>
              <textarea rows={2} value={form.guidelines} onChange={(e) => set("guidelines", e.target.value)}
                placeholder="Pacing, energy, what to include/avoid..."
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </form>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0 flex gap-2.5">
          <button onClick={onDelete} className="px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 rounded-xl transition-colors">Delete</button>
          <button type="submit" form="promoteForm" disabled={promoting}
            className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-60 transition-colors">
            {promoting ? "Saving…" : "🚀 Save as Concept"}
          </button>
        </div>
      </div>
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
      body: JSON.stringify({ ...form, isIdea: false }),
    });
    onSaved();
  }

  return (
    <Modal title="New Concept" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Hook Type</label>
            <input list="hookTypeList" value={form.hookType} onChange={(e) => set("hookType", e.target.value)}
              placeholder="e.g. question, curiosity_gap..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <datalist id="hookTypeList">
              {HOOK_TYPE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Video Type</label>
            <input list="videoTypeList" value={form.videoType} onChange={(e) => set("videoType", e.target.value)}
              placeholder="e.g. talking_head, broll..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
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
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Angle</label>
            <input value={form.angle} onChange={(e) => set("angle", e.target.value)}
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
            <span className="ml-1.5 text-[10px] font-normal text-slate-400">Paste 1–3 real scripts that worked well</span>
          </label>
          <textarea rows={6} value={form.scriptExamples} onChange={(e) => set("scriptExamples", e.target.value)}
            placeholder={"Example script 1:\n---\nHook: Did you know most people waste their first 3 seconds?\n[Script body here...]\n\n---\nExample script 2:\n[Another working script...]"}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Example URL</label>
            <input type="url" value={form.exampleUrl} onChange={(e) => set("exampleUrl", e.target.value)}
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
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">Global</span>
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
