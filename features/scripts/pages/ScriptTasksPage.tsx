"use client";

import { useCallback, useEffect, useState } from "react";
import { Client, Concept, ScriptDraft } from "@/shared/types";

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
  const [addOpen, setAddOpen] = useState<Record<number, boolean>>({});
  const [assignQty, setAssignQty] = useState<Record<number, number>>({});
  const [revise, setRevise] = useState<Record<number, string>>({});
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
    const created = new Date(c.createdAt).getTime();
    const anchorMs = anchorStr ? new Date(anchorStr + "T00:00:00").getTime() : created;
    const now = Date.now();
    // Roll the [start, end) window so it always contains "now" — never excludes a
    // script the client just submitted, even if the anchor sits in the future.
    let start = anchorMs;
    let end = anchorMs + interval * DAY;
    while (end <= now) { start = end; end += interval * DAY; }
    while (start > now) { end = start; start -= interval * DAY; }
    // Don't count drafts from before the concept existed.
    const lower = Math.max(start, created);
    return { start: new Date(lower), end: new Date(end) };
  }

  async function submit(c: Concept) {
    const v = (inputs[c.id] || "").trim();
    if (!v || !client) return;
    setSubmitting(c.id);
    try {
      await fetch("/api/script-drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, conceptId: c.id, title: `${c.name} — ${client.name} script`, script: v, weekLabel: `Week ${WEEK_NUMBER}`, clientAuthored: canSubmit }),
      });
      setInputs((p) => ({ ...p, [c.id]: "" }));
      setAddOpen((p) => ({ ...p, [c.id]: false }));
      load();
    } finally {
      setSubmitting(null);
    }
  }

  // Owner: re-assign a fresh round of scripts to the client at any time. We just roll the
  // cycle anchor to today (so a new window starts now) and set the quota — the client's
  // writing tasks reappear, defaulting to the same amount as the last run.
  async function assignRound(c: Concept) {
    if (!client) return;
    const qty = Math.max(1, parseInt(String(assignQty[c.id] ?? (c as any).clientQuota ?? 1)) || 1);
    setSubmitting(c.id);
    try {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      await fetch(`/api/concepts/${c.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientAnchor: today, clientQuota: qty }),
      });
      setAddOpen((p) => ({ ...p, [c.id]: false }));
      load();
    } finally {
      setSubmitting(null);
    }
  }

  // Revise a rejected draft and resubmit it — back to pending (Ideas), feedback cleared.
  async function resubmit(d: ScriptDraft) {
    const v = (revise[d.id] ?? "").trim();
    if (!v) return;
    setSubmitting(d.id);
    try {
      await fetch(`/api/script-drafts/${d.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: v, status: "pending", stageId: null, rejectionFeedback: null }),
      });
      setRevise((p) => { const n = { ...p }; delete n[d.id]; return n; });
      load();
    } finally {
      setSubmitting(null);
    }
  }

  if (!client) return <div className="text-sm text-faint">Select a client.</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="mb-5 flex-shrink-0">
        <h1 className="text-2xl font-bold text-ink">Script Tasks</h1>
        <p className="text-muted text-sm mt-0.5">
          {canSubmit ? "Concepts you write the scripts for — submit them for the team to review." : `${client.name}'s self-written script tasks and progress.`}
        </p>
      </div>

      {concepts.length === 0 ? (
        <div className="bg-surface rounded-2xl border border-dashed border-line p-16 text-center">
          <div className="text-3xl mb-2">🧑‍💻</div>
          <p className="text-sm font-semibold text-ink-2">No script tasks{canSubmit ? "" : ` for ${client.name}`}</p>
          <p className="text-xs text-faint mt-1">A task appears here when a concept is set to “Client writes the scripts”.</p>
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
            // Rejected drafts don't count toward the quota — the client has to revise them.
            const rejected = cycleDrafts.filter((d) => d.status === "rejected");
            const active = cycleDrafts.filter((d) => d.status !== "rejected");
            const done = active.length;
            const remaining = Math.max(0, quota - done);
            const dueStr = end.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            const cat = (c as any).conceptType ? `${(c as any).conceptType} · ` : "";
            return (
              <div key={c.id} className="bg-surface border border-line rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-bold text-ink">{cat}{c.name}</p>
                  <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${remaining === 0 ? "bg-ok-100 text-ok-700" : "bg-info-100 text-info-700"}`}>
                    {remaining === 0 ? "✓ Done this cycle" : `${done}/${quota} written · due ${dueStr}`}
                  </span>
                </div>

                {/* Rejected scripts — feedback sent back by the team. Client revises & resubmits. */}
                {rejected.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {rejected.map((d) => (
                      <div key={d.id} className="bg-danger-50 border border-danger-200 rounded-lg px-3 py-2.5">
                        <p className="text-[10px] font-semibold text-danger-500 uppercase tracking-wide mb-1">↩ Needs changes</p>
                        {d.rejectionFeedback && (
                          <p className="text-xs text-danger-700 font-medium mb-1.5">Feedback: {d.rejectionFeedback}</p>
                        )}
                        <p className="text-xs text-muted whitespace-pre-line leading-relaxed mb-2 line-clamp-3">{d.script}</p>
                        {canSubmit ? (
                          <div className="space-y-1.5">
                            <textarea rows={3} value={revise[d.id] ?? d.script}
                              onChange={(e) => setRevise((p) => ({ ...p, [d.id]: e.target.value }))}
                              className="w-full border border-danger-200 rounded-lg px-3 py-2 text-sm font-mono bg-surface focus:outline-none focus:ring-2 focus:ring-danger-300 resize-none" />
                            <div className="flex justify-end">
                              <button onClick={() => resubmit(d)} disabled={submitting === d.id || !(revise[d.id] ?? d.script).trim()}
                                className="px-3 py-1.5 text-xs font-semibold text-on-status bg-danger-600 rounded-lg hover:bg-danger-700 disabled:opacity-50">
                                {submitting === d.id ? "Resubmitting…" : "Revise & resubmit"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[11px] text-danger-400">Sent back to the client to revise.</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Submitted scripts this cycle (visible to owner + client) */}
                {active.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {active.map((d, i) => (
                      <div key={d.id} className="flex items-start gap-2 bg-surface-2 border border-line rounded-lg px-3 py-2">
                        <span className="text-ok-500 text-xs mt-0.5">✓</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-semibold text-faint uppercase tracking-wide mb-0.5">
                            Script {i + 1} · {d.stageId ? "in production" : "submitted for review"}
                          </p>
                          <p className="text-xs text-ink-2 whitespace-pre-line leading-relaxed">{d.script}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Writer (client): writes ONE script at a time, up to the assigned quota. */}
                {canSubmit && remaining > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-muted">Write script {done + 1} of {quota}</p>
                    <textarea rows={4} value={inputs[c.id] ?? ""}
                      onChange={(e) => setInputs((p) => ({ ...p, [c.id]: e.target.value }))}
                      placeholder="Write the on-screen text / script here…"
                      className="w-full border border-line rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-info-400 resize-none" />
                    <div className="flex justify-end">
                      <button onClick={() => submit(c)} disabled={submitting === c.id || !(inputs[c.id] || "").trim()}
                        className="px-4 py-1.5 text-xs font-semibold text-on-status bg-info-600 rounded-lg hover:bg-info-700 disabled:opacity-50">
                        {submitting === c.id ? "Submitting…" : "Submit this script for review"}
                      </button>
                    </div>
                    {remaining > 1 && <p className="text-[11px] text-faint text-right">{remaining - 1} more after this one.</p>}
                  </div>
                )}
                {canSubmit && remaining === 0 && (
                  <p className="text-xs text-faint">All assigned scripts are in. Nothing to write right now 🎉</p>
                )}

                {/* Owner: re-assign a fresh round to the client anytime — defaults to the
                    same amount as the last run. Don then sees the writing tasks again. */}
                {!canSubmit && (
                  addOpen[c.id] ? (
                    <div className="flex items-center justify-between gap-3 bg-surface-2 border border-line rounded-lg px-3 py-2.5">
                      <div className="flex items-center gap-2 text-xs text-ink-2">
                        <span className="font-semibold">Assign</span>
                        <input type="number" min={1}
                          value={assignQty[c.id] ?? (quota || 1)}
                          onChange={(e) => setAssignQty((p) => ({ ...p, [c.id]: parseInt(e.target.value) || 1 }))}
                          className="w-16 border border-line-2 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-info-400" />
                        <span>new script{(assignQty[c.id] ?? quota) === 1 ? "" : "s"} to {client.name}</span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setAddOpen((p) => ({ ...p, [c.id]: false }))}
                          className="px-3 py-1.5 text-xs font-semibold text-muted hover:text-ink-2">Cancel</button>
                        <button onClick={() => assignRound(c)} disabled={submitting === c.id}
                          className="px-4 py-1.5 text-xs font-semibold text-on-status bg-info-600 rounded-lg hover:bg-info-700 disabled:opacity-50">
                          {submitting === c.id ? "Assigning…" : "Assign"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setAssignQty((p) => ({ ...p, [c.id]: quota || 1 })); setAddOpen((p) => ({ ...p, [c.id]: true })); }}
                      className="w-full py-2 text-xs font-semibold text-muted border border-dashed border-line-2 rounded-lg hover:border-info-400 hover:text-info-600 transition-colors">
                      ↻ Assign a new round{quota ? ` (${quota} script${quota > 1 ? "s" : ""})` : ""} to {client.name}
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
      {loading && <p className="text-xs text-faint mt-3">Loading…</p>}
    </div>
  );
}
