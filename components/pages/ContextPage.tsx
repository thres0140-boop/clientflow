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

export default function ContextPage({ clients, selectedClientId }: Props) {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [feedbacks, setFeedbacks] = useState<ConceptFeedback[]>([]);
  const [openConceptId, setOpenConceptId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

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

  // Per-concept summary stats
  function getStats(conceptId: number) {
    const items = feedbacks.filter((f) => f.conceptId === conceptId);
    const byType: Record<string, number> = {};
    for (const f of items) byType[f.reasonType] = (byType[f.reasonType] || 0) + 1;
    return { total: items.length, byType, items };
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
            const topReasons = Object.entries(byType)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3);

            return (
              <div key={concept.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                {/* Concept header */}
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

                {/* Expanded rejection history */}
                {isOpen && (
                  <div className="border-t border-slate-100">
                    {/* Stats bar */}
                    <div className="px-5 py-3 bg-slate-50 flex items-center gap-6 flex-wrap">
                      {Object.entries(byType).map(([type, count]) => {
                        const meta = REASON_LABELS[type];
                        const pct = Math.round((count / total) * 100);
                        return (
                          <div key={type} className="flex items-center gap-2">
                            <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${meta?.color || "bg-slate-100 text-slate-500"}`}>
                              {meta?.emoji} {pct}%
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Individual rejection cards */}
                    <div className="divide-y divide-slate-50">
                      {items.map((fb) => {
                        const meta = REASON_LABELS[fb.reasonType];
                        return (
                          <div key={fb.id} className="px-5 py-3 flex items-start gap-3 group/fb hover:bg-slate-50">
                            <span className={`mt-0.5 text-[10px] font-semibold px-2 py-1 rounded-lg flex-shrink-0 ${meta?.color || "bg-slate-100 text-slate-500"}`}>
                              {meta?.emoji} {meta?.label}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-700 truncate">{fb.title}</p>
                              {fb.hook && (
                                <p className="text-[11px] text-slate-400 italic mt-0.5 line-clamp-1">Hook: "{fb.hook}"</p>
                              )}
                              {fb.scriptSnippet && (
                                <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{fb.scriptSnippet}…</p>
                              )}
                              {fb.reason && (
                                <p className="text-[11px] text-indigo-600 mt-0.5 font-medium">💬 "{fb.reason}"</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[10px] text-slate-300">
                                {new Date(fb.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                              </span>
                              <button
                                onClick={() => deleteFeedback(fb.id)}
                                disabled={deletingId === fb.id}
                                className="opacity-0 group-hover/fb:opacity-100 text-slate-300 hover:text-red-400 transition-all text-sm"
                                title="Remove this signal"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
                      <p className="text-[10px] text-slate-400">
                        🧠 Claude reads all {total} rejection signals before generating new scripts for this concept.
                      </p>
                    </div>
                  </div>
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
            {conceptsWithoutFeedback.map((concept) => (
              <div key={concept.id} className="px-5 py-3 flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-slate-400 text-xs font-bold">{concept.name[0]}</span>
                </div>
                <p className="text-sm text-slate-500">{concept.name}</p>
                <span className="ml-auto text-[10px] text-slate-300">Reject scripts in Kanban to start training Claude</span>
              </div>
            ))}
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
