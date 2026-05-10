"use client";

import { useEffect, useState, useCallback } from "react";
import { Client, Concept } from "@/lib/types";

type ConceptFeedback = {
  id: number;
  conceptId: number;
  clientId: number;
  title: string;
  hook: string | null;
  scriptSnippet: string | null;
  reasonType: string;
  reason: string | null;
  createdAt: string;
  concept?: { id: number; name: string };
};

type Props = {
  clients: Client[];
  selectedClientId: number | null;
};

const REASON_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  others_better: { label: "Others were better", emoji: "🏆", color: "bg-amber-100 text-amber-700" },
  wrong_angle:   { label: "Wrong angle / topic", emoji: "🎯", color: "bg-orange-100 text-orange-700" },
  hook_bad:      { label: "Hook doesn't land",   emoji: "🪝", color: "bg-red-100 text-red-700" },
  too_long:      { label: "Too long",            emoji: "📏", color: "bg-blue-100 text-blue-700" },
  too_short:     { label: "Too short",           emoji: "✂️", color: "bg-cyan-100 text-cyan-700" },
  off_brand:     { label: "Off-brand",           emoji: "🚫", color: "bg-slate-100 text-slate-700" },
  custom:        { label: "Custom feedback",     emoji: "✏️", color: "bg-purple-100 text-purple-700" },
};

const DEFAULT_RULES = `1. VOICE IS EVERYTHING
   The #1 mistake is writing scripts that sound "written."
   Every line must sound like the creator talking to a friend.
   If it sounds like a copywriter wrote it → rewrite.

2. DATA OVER OPINION
   Every decision (hook formula, structure, duration, visuals, audio)
   must be backed by the actual performance data from the videos.
   "This hook style averaged 250K views" beats "I think this works."

3. SPECIFICITY WINS
   Vague hooks underperform. Specific trigger words, specific moments,
   specific details — these stop the scroll.

4. CONTRAST = SCROLL STOPPER
   In most niches, the combination of calm delivery/music with hard
   or controversial words creates the pattern interrupt that stops
   people from scrolling. Check if this applies to your creator.

5. THE SYSTEM IS ALIVE
   After the first batch of scripts goes live, track what performs.
   Feed the data back: kill what doesn't work, double down on what does.
   Update the style guide, add new trigger words, remove dead concepts.

6. CAPTION ≠ SCRIPT
   This is the most common mistake. The caption must approach the
   SAME THEME from a COMPLETELY DIFFERENT ANGLE. If the script talks
   about the moment of weakness, the caption talks about the people
   watching you fall. Same theme, different perspective.

7. 2+ PILLARS OR KILL IT
   Single-pillar content is generic. If a script only touches one
   pillar, it's not specific enough to the creator. Merge pillars
   for stronger, more unique content`;

type BlueprintDraft = {
  hookType: string;
  textHook: string;
  videoType: string;
  angle: string;
  structure: string;
  guidelines: string;
};

export default function ContextPage({ clients, selectedClientId }: Props) {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [feedbacks, setFeedbacks] = useState<ConceptFeedback[]>([]);
  const [openConceptId, setOpenConceptId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [conceptRulesEditing, setConceptRulesEditing] = useState<number | null>(null);
  const [conceptRulesText, setConceptRulesText] = useState<Record<number, string>>({});
  const [savingConceptRules, setSavingConceptRules] = useState<number | null>(null);
  const [blueprintEditing, setBlueprintEditing] = useState<number | null>(null);
  const [blueprintDraft, setBlueprintDraft] = useState<Record<number, BlueprintDraft>>({});
  const [savingBlueprint, setSavingBlueprint] = useState<number | null>(null);

  const client = clients.find((c) => c.id === selectedClientId) ?? null;

  const reload = useCallback(async () => {
    if (!selectedClientId) return;
    const [co, fb] = await Promise.all([
      fetch(`/api/concepts?clientId=${selectedClientId}`).then((r) => r.json()),
      fetch(`/api/concept-feedback?clientId=${selectedClientId}`).then((r) => r.json()),
    ]);
    setConcepts((co as Concept[]).filter((c) => !c.isIdea));
    setFeedbacks(fb);
  }, [selectedClientId]);

  useEffect(() => { reload(); }, [reload]);

  async function saveConceptRules(conceptId: number) {
    setSavingConceptRules(conceptId);
    const text = conceptRulesText[conceptId] ?? "";
    await fetch(`/api/concepts/${conceptId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scriptRules: text }),
    });
    setConcepts((prev) => prev.map((c) => c.id === conceptId ? { ...c, scriptRules: text || null } : c));
    setSavingConceptRules(null);
    setConceptRulesEditing(null);
  }

  function startConceptRulesEdit(concept: Concept) {
    setConceptRulesText((prev) => ({ ...prev, [concept.id]: concept.scriptRules ?? DEFAULT_RULES }));
    setConceptRulesEditing(concept.id);
  }

  function startBlueprintEdit(concept: Concept) {
    setBlueprintDraft((prev) => ({
      ...prev,
      [concept.id]: {
        hookType: concept.hookType ?? "",
        textHook: concept.textHook ?? "",
        videoType: concept.videoType ?? "",
        angle: concept.angle ?? "",
        structure: concept.structure ?? "",
        guidelines: concept.guidelines ?? "",
      },
    }));
    setBlueprintEditing(concept.id);
  }

  async function saveBlueprint(conceptId: number) {
    setSavingBlueprint(conceptId);
    const d = blueprintDraft[conceptId];
    await fetch(`/api/concepts/${conceptId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hookType: d.hookType || null,
        textHook: d.textHook || null,
        videoType: d.videoType || null,
        angle: d.angle || null,
        structure: d.structure || null,
        guidelines: d.guidelines || null,
      }),
    });
    setConcepts((prev) => prev.map((c) => c.id === conceptId ? {
      ...c,
      hookType: d.hookType || null,
      textHook: d.textHook || null,
      videoType: d.videoType || null,
      angle: d.angle || null,
      structure: d.structure || null,
      guidelines: d.guidelines || null,
    } : c));
    setSavingBlueprint(null);
    setBlueprintEditing(null);
  }

  async function deleteFeedback(id: number) {
    setDeletingId(id);
    await fetch(`/api/concept-feedback/${id}`, { method: "DELETE" });
    setFeedbacks((prev) => prev.filter((f) => f.id !== id));
    setDeletingId(null);
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-slate-400 text-sm">Select a client to view their AI context.</p>
      </div>
    );
  }

  const conceptsWithFeedback = concepts.filter((c) =>
    feedbacks.some((f) => f.conceptId === c.id)
  );
  const conceptsWithoutFeedback = concepts.filter((c) =>
    !feedbacks.some((f) => f.conceptId === c.id)
  );

  function getStats(conceptId: number) {
    const items = feedbacks.filter((f) => f.conceptId === conceptId);
    const byType: Record<string, number> = {};
    for (const f of items) byType[f.reasonType] = (byType[f.reasonType] || 0) + 1;
    return { total: items.length, byType, items };
  }

  function patchDraft(id: number, key: keyof BlueprintDraft, val: string) {
    setBlueprintDraft((prev) => ({ ...prev, [id]: { ...prev[id], [key]: val } }));
  }

  function ConceptPipeline({ concept, total, byType, items }: {
    concept: Concept;
    total?: number;
    byType?: Record<string, number>;
    items?: ConceptFeedback[];
  }) {
    const d = blueprintDraft[concept.id];
    const isEditingBlueprint = blueprintEditing === concept.id;

    return (
      <div className="border-t border-slate-100">
        {/* Pipeline header */}
        <div className="px-5 pt-4 pb-2">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">How Claude generates scripts for this concept</p>
          <div className="flex items-center gap-1.5 mt-2 text-[10px] text-slate-400">
            <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-semibold">1 Blueprint</span>
            <span>→</span>
            <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 font-semibold">2 Example Scripts</span>
            <span>→</span>
            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-600 font-semibold">3 Rejection Training</span>
            <span>→</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-semibold">Claude Output</span>
          </div>
        </div>

        {/* Step 1: Blueprint */}
        <div className="mx-5 mb-3 rounded-xl border border-indigo-200 bg-indigo-50/40 overflow-hidden">
          <div className="px-4 py-2 bg-indigo-100/60 border-b border-indigo-200 flex items-center justify-between">
            <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wide">① Blueprint — the concept template Claude always follows</p>
            {!isEditingBlueprint && (
              <button onClick={() => startBlueprintEdit(concept)}
                className="text-[9px] text-indigo-500 hover:text-indigo-700 font-semibold px-2 py-0.5 rounded border border-indigo-200 hover:bg-indigo-100 transition-colors">
                Edit
              </button>
            )}
          </div>

          {isEditingBlueprint && d ? (
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide mb-1">Hook Type</p>
                  <input value={d.hookType} onChange={(e) => patchDraft(concept.id, "hookType", e.target.value)}
                    placeholder="e.g. curiosity_gap"
                    className="w-full text-xs border border-indigo-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
                </div>
                <div>
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide mb-1">Video Type</p>
                  <input value={d.videoType} onChange={(e) => patchDraft(concept.id, "videoType", e.target.value)}
                    placeholder="e.g. talking_head"
                    className="w-full text-xs border border-indigo-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
                </div>
                <div>
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide mb-1">Text Hook</p>
                  <input value={d.textHook} onChange={(e) => patchDraft(concept.id, "textHook", e.target.value)}
                    placeholder="Opening text overlay"
                    className="w-full text-xs border border-indigo-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
                </div>
                <div>
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide mb-1">Angle</p>
                  <input value={d.angle} onChange={(e) => patchDraft(concept.id, "angle", e.target.value)}
                    placeholder="e.g. Beginner mistakes"
                    className="w-full text-xs border border-indigo-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
                </div>
                <div className="col-span-2">
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide mb-1">Structure</p>
                  <input value={d.structure} onChange={(e) => patchDraft(concept.id, "structure", e.target.value)}
                    placeholder="Hook (3s) → Problem (6s) → Solution (10s) → CTA (3s)"
                    className="w-full text-xs border border-indigo-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
                </div>
                <div className="col-span-2">
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide mb-1">Guidelines</p>
                  <textarea value={d.guidelines} onChange={(e) => patchDraft(concept.id, "guidelines", e.target.value)}
                    rows={3} placeholder="Extra instructions for Claude..."
                    className="w-full text-xs border border-indigo-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white" />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setBlueprintEditing(null)}
                  className="text-[10px] text-slate-400 hover:text-slate-600 px-2.5 py-1 rounded border border-slate-200 transition-colors">Cancel</button>
                <button onClick={() => saveBlueprint(concept.id)} disabled={savingBlueprint === concept.id}
                  className="text-[10px] font-semibold text-white bg-indigo-500 hover:bg-indigo-600 px-3 py-1 rounded transition-colors disabled:opacity-50">
                  {savingBlueprint === concept.id ? "Saving…" : "Save Blueprint"}
                </button>
              </div>
            </div>
          ) : (
            <div className="p-4 grid grid-cols-2 gap-3">
              {concept.hookType && (
                <div>
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide mb-0.5">Hook Type</p>
                  <p className="text-xs text-slate-700 capitalize">{concept.hookType.replace(/_/g, " ")}</p>
                </div>
              )}
              {concept.textHook && (
                <div>
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide mb-0.5">Text Hook</p>
                  <p className="text-xs text-slate-700 italic">&ldquo;{concept.textHook}&rdquo;</p>
                </div>
              )}
              {concept.videoType && (
                <div>
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide mb-0.5">Video Type</p>
                  <p className="text-xs text-slate-700 capitalize">{concept.videoType.replace(/_/g, " ")}</p>
                </div>
              )}
              {concept.angle && (
                <div>
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide mb-0.5">Angle</p>
                  <p className="text-xs text-slate-700">{concept.angle}</p>
                </div>
              )}
              {concept.structure && (
                <div className="col-span-2">
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide mb-0.5">Structure</p>
                  <p className="text-xs text-slate-700 whitespace-pre-line">{concept.structure}</p>
                </div>
              )}
              {concept.guidelines && (
                <div className="col-span-2">
                  <p className="text-[9px] font-bold text-indigo-400 uppercase tracking-wide mb-0.5">Guidelines</p>
                  <p className="text-xs text-slate-700 whitespace-pre-line">{concept.guidelines}</p>
                </div>
              )}
              {!concept.hookType && !concept.angle && !concept.structure && !concept.guidelines && (
                <p className="col-span-2 text-xs text-slate-400 italic">No blueprint set — click Edit to add details.</p>
              )}
              {/* Writing rules */}
              <div className="col-span-2 mt-1 border-t border-indigo-100 pt-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[9px] font-bold text-amber-500 uppercase tracking-wide">📐 Writing Rules</p>
                  {conceptRulesEditing !== concept.id && (
                    <button onClick={() => startConceptRulesEdit(concept)}
                      className="text-[9px] text-amber-500 hover:text-amber-700 font-semibold px-2 py-0.5 rounded border border-amber-200 hover:bg-amber-50 transition-colors">
                      {concept.scriptRules ? "Edit" : "+ Add"}
                    </button>
                  )}
                </div>
                {conceptRulesEditing === concept.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={conceptRulesText[concept.id] ?? ""}
                      onChange={(e) => setConceptRulesText((prev) => ({ ...prev, [concept.id]: e.target.value }))}
                      rows={10}
                      className="w-full text-xs text-slate-700 border border-amber-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-amber-300 bg-amber-50/30 font-mono leading-relaxed"
                    />
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setConceptRulesEditing(null)}
                        className="text-[10px] text-slate-400 hover:text-slate-600 px-2.5 py-1 rounded border border-slate-200 transition-colors">Cancel</button>
                      <button onClick={() => saveConceptRules(concept.id)} disabled={savingConceptRules === concept.id}
                        className="text-[10px] font-semibold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1 rounded transition-colors disabled:opacity-50">
                        {savingConceptRules === concept.id ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                ) : concept.scriptRules ? (
                  <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans leading-relaxed">{concept.scriptRules}</pre>
                ) : (
                  <p className="text-xs text-slate-400 italic">No writing rules yet — click + Add (pre-filled with default rules).</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Step 2: Example Scripts */}
        <div className="mx-5 mb-3 rounded-xl border border-violet-200 bg-violet-50/40 overflow-hidden">
          <div className="px-4 py-2 bg-violet-100/60 border-b border-violet-200">
            <p className="text-[10px] font-bold text-violet-600 uppercase tracking-wide">② Example Scripts — reference scripts Claude studied for this concept</p>
          </div>
          <div className="p-4">
            {concept.scriptExamples ? (
              <div className="space-y-2">
                {concept.scriptExamples.split(/\n{2,}/).filter(Boolean).map((ex, i) => (
                  <div key={i} className="bg-white rounded-lg border border-violet-100 px-3 py-2">
                    <p className="text-[9px] font-bold text-violet-400 uppercase mb-1">Example {i + 1}</p>
                    <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed">{ex.trim()}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">No example scripts added yet — paste reference scripts in the Concept Library to improve output quality.</p>
            )}
          </div>
        </div>

        {/* Step 3: Rejection Training */}
        <div className="mx-5 mb-4 rounded-xl border border-rose-200 bg-rose-50/40 overflow-hidden">
          <div className="px-4 py-2 bg-rose-100/60 border-b border-rose-200 flex items-center justify-between">
            <p className="text-[10px] font-bold text-rose-600 uppercase tracking-wide">
              ③ Rejection Training — {total ?? 0} signals teaching Claude what NOT to do
            </p>
            {(total ?? 0) > 0 && <span className="text-[9px] text-rose-400">Claude reads these before every generation</span>}
          </div>
          {(total ?? 0) > 0 && byType && items ? (
            <>
              <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-100 flex items-center gap-4 flex-wrap">
                {Object.entries(byType).map(([type, count]) => {
                  const meta = REASON_LABELS[type];
                  const pct = Math.round((count / (total ?? 1)) * 100);
                  return (
                    <div key={type} className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-rose-200 rounded-full overflow-hidden">
                        <div className="h-full bg-rose-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${meta?.color || "bg-slate-100 text-slate-500"}`}>
                        {meta?.emoji} {pct}%
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="divide-y divide-rose-100">
                {items.map((fb) => {
                  const meta = REASON_LABELS[fb.reasonType];
                  return (
                    <div key={fb.id} className="px-4 py-2.5 flex items-start gap-3 group/fb hover:bg-rose-50/50">
                      <span className={`mt-0.5 text-[10px] font-semibold px-2 py-1 rounded-lg flex-shrink-0 ${meta?.color || "bg-slate-100 text-slate-500"}`}>
                        {meta?.emoji} {meta?.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-700 truncate">{fb.title}</p>
                        {fb.hook && <p className="text-[11px] text-slate-400 italic mt-0.5 line-clamp-1">Hook: &ldquo;{fb.hook}&rdquo;</p>}
                        {fb.reason && <p className="text-[11px] text-rose-600 mt-0.5 font-medium">💬 &ldquo;{fb.reason}&rdquo;</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-slate-300">
                          {new Date(fb.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </span>
                        <button onClick={() => deleteFeedback(fb.id)} disabled={deletingId === fb.id}
                          className="opacity-0 group-hover/fb:opacity-100 text-slate-300 hover:text-red-400 transition-all text-sm">×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="px-4 py-3">
              <p className="text-xs text-slate-400 italic">No rejections logged yet. Reject scripts with a reason in the Kanban to start training Claude on what to avoid.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Context</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            What Claude has learned per concept for {client.name}
          </p>
        </div>
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2">
          <span className="text-indigo-500 text-sm">🧠</span>
          <div>
            <p className="text-xs font-semibold text-indigo-700">{feedbacks.length} rejection signals</p>
            <p className="text-[10px] text-indigo-400">across {conceptsWithFeedback.length} concepts</p>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">How it works</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="flex items-start gap-2.5">
            <span className="text-lg mt-0.5">🪝</span>
            <div>
              <p className="text-xs font-semibold text-slate-700">Rejection Tracking</p>
              <p className="text-[11px] text-slate-400">Every rejected script stores why it failed for that concept</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="text-lg mt-0.5">🧠</span>
            <div>
              <p className="text-xs font-semibold text-slate-700">Automatic Learning</p>
              <p className="text-[11px] text-slate-400">Claude reads this history before generating new scripts</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="text-lg mt-0.5">📈</span>
            <div>
              <p className="text-xs font-semibold text-slate-700">Gets Better Over Time</p>
              <p className="text-[11px] text-slate-400">The more you reject with reasons, the better the outputs</p>
            </div>
          </div>
        </div>
      </div>

      {/* Concepts with feedback */}
      {conceptsWithFeedback.length > 0 && (
        <div className="space-y-3">
          {conceptsWithFeedback.map((concept) => {
            const { total, byType, items } = getStats(concept.id);
            const isOpen = openConceptId === concept.id;
            const topReasons = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 3);

            return (
              <div key={concept.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <button
                  onClick={() => setOpenConceptId(isOpen ? null : concept.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-indigo-600 text-sm font-bold">{concept.name[0]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{concept.name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {topReasons.map(([type, count]) => {
                        const meta = REASON_LABELS[type];
                        return (
                          <span key={type} className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${meta?.color || "bg-slate-100 text-slate-500"}`}>
                            {meta?.emoji} {meta?.label} ({count})
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-slate-800">{total}</p>
                    <p className="text-[10px] text-slate-400">rejections</p>
                  </div>
                  <span className={`text-slate-400 ml-2 transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
                </button>
                {isOpen && (
                  <ConceptPipeline concept={concept} total={total} byType={byType} items={items} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Concepts without any feedback yet */}
      {conceptsWithoutFeedback.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-500">No feedback yet</h3>
          </div>
          <div className="divide-y divide-slate-50">
            {conceptsWithoutFeedback.map((concept) => {
              const isOpen = openConceptId === concept.id;
              return (
                <div key={concept.id}>
                  <button
                    onClick={() => setOpenConceptId(isOpen ? null : concept.id)}
                    className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-slate-50 cursor-pointer"
                  >
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-slate-400 text-xs font-bold">{concept.name[0]}</span>
                    </div>
                    <p className="text-sm text-slate-500">{concept.name}</p>
                    <span className="ml-auto text-[10px] text-slate-300">View pipeline</span>
                    <span className={`text-slate-300 text-xs transition-transform ${isOpen ? "rotate-180" : ""}`}>▾</span>
                  </button>
                  {isOpen && <ConceptPipeline concept={concept} />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {concepts.length === 0 && (
        <div className="text-center py-20">
          <p className="text-slate-400 text-sm">No concepts found for {client.name}.</p>
        </div>
      )}
    </div>
  );
}
