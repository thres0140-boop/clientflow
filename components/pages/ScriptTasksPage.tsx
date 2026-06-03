"use client";

import { useCallback, useEffect, useState } from "react";
import { Client, Concept, ScriptDraft } from "@/lib/types";

const DAY = 86400000;
const WEEK_NUMBER = Math.ceil((((new Date()).getTime() - new Date(new Date().getFullYear(), 0, 1).getTime()) / DAY + new Date(new Date().getFullYear(), 0, 1).getDay() + 1) / 7);

type Props = {
  clients: Client[];
  selectedClientId: number | null;
  // true when the logged-in viewer is the client/member who writes the scripts;
  // false for the owner, who gets a read-only progress overview.
  canSubmit?: boolean;
};

export default function ScriptTasksPage({ clients, selectedClientId, canSubmit = false }: Props) {
  const client = clients.find((c) => c.id === selectedClientId) ?? null;
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [drafts, setDrafts] = useState<ScriptDraft[]>([]);
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!selectedClientId) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/concepts?clientId=${selectedClientId}`).then((r) => r.json()),
      fetch(`/api/script-drafts?clientId=${selectedClientId}&all=true`).then((r) => r.json()),
    ]).then(([co, dr]) => {
      setConcepts((Array.isArray(co) ? co : []).filter((c: Concept) => (c as any).clientOwned && !c.isIdea));
      setDrafts(Array.isArray(dr) ? dr : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [selectedClientId]);

  useEffect(() => { load(); }, [load]);

  function cycle(c: Concept) {
    const interval = ((c as any).clientIntervalDays || 7);
    const anchorStr = (c as any).clientAnchor as string | null;
    const anchor = anchorStr ? new Date(anchorStr + "T00:00:00") : new Date(c.createdAt);
    const now = Date.now();
    const passed = Math.max(0, Math.floor((now - anchor.getTime()) / DAY / interval));
    const start = new Date(anchor.getTime() + passed * interval * DAY);
    const end = new Date(start.getTime() + interval * DAY);
    return { start, end };
  }

  async function submit(c: Concept) {
    const v = (inputs[c.id] || "").trim();
    if (!v || !client) return;
    setSubmitting(c.id);
    try {
      await fetch("/api/script-drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, conceptId: c.id, title: `${c.name} — ${client.name} script`, script: v, weekLabel: `Week ${WEEK_NUMBER}` }),
      });
      setInputs((p) => ({ ...p, [c.id]: "" }));
      load();
    } finally {
      setSubmitting(null);
    }
  }

  if (!client) return <div className="text-sm text-slate-400">Select a client.</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="mb-5 flex-shrink-0">
        <h1 className="text-2xl font-bold text-slate-900">Script Tasks</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {canSubmit ? "Concepts you write the scripts for — submit them for the team to review." : `${client.name}'s self-written script tasks and progress.`}
        </p>
      </div>

      {concepts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-16 text-center">
          <div className="text-3xl mb-2">🧑‍💻</div>
          <p className="text-sm font-semibold text-slate-700">No script tasks{canSubmit ? "" : ` for ${client.name}`}</p>
          <p className="text-xs text-slate-400 mt-1">A task appears here when a concept is set to “Client writes the scripts”.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {concepts.map((c) => {
            const { start, end } = cycle(c);
            const quota = (c as any).clientQuota || 0;
            const cycleDrafts = drafts.filter((d) => {
              if (d.conceptId !== c.id) return false;
              const g = new Date(d.generatedAt).getTime();
              return g >= start.getTime() && g < end.getTime();
            });
            const done = cycleDrafts.length;
            const remaining = Math.max(0, quota - done);
            const dueStr = end.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            const cat = (c as any).conceptType ? `${(c as any).conceptType} · ` : "";
            return (
              <div key={c.id} className="bg-white border border-slate-200 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-bold text-slate-800">{cat}{c.name}</p>
                  <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${remaining === 0 ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                    {remaining === 0 ? "✓ Done this cycle" : `${done}/${quota} written · due ${dueStr}`}
                  </span>
                </div>

                {/* Submitted scripts this cycle (visible to owner + client) */}
                {cycleDrafts.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {cycleDrafts.map((d, i) => (
                      <div key={d.id} className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                        <span className="text-green-500 text-xs mt-0.5">✓</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Script {i + 1} · submitted for review</p>
                          <p className="text-xs text-slate-600 whitespace-pre-line leading-relaxed">{d.script}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Writing area — client writes ONE script at a time and submits it */}
                {canSubmit && remaining > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-slate-500">Write script {done + 1} of {quota}</p>
                    <textarea rows={4} value={inputs[c.id] ?? ""}
                      onChange={(e) => setInputs((p) => ({ ...p, [c.id]: e.target.value }))}
                      placeholder="Write the on-screen text / script here…"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
                    <div className="flex justify-end">
                      <button onClick={() => submit(c)} disabled={submitting === c.id || !(inputs[c.id] || "").trim()}
                        className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                        {submitting === c.id ? "Submitting…" : "Submit this script for review"}
                      </button>
                    </div>
                    {remaining > 1 && <p className="text-[11px] text-slate-400 text-right">{remaining - 1} more after this one.</p>}
                  </div>
                )}
                {!canSubmit && remaining > 0 && (
                  <p className="text-xs text-slate-400">Waiting on {remaining} more script{remaining !== 1 ? "s" : ""} from the client.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
      {loading && <p className="text-xs text-slate-400 mt-3">Loading…</p>}
    </div>
  );
}
