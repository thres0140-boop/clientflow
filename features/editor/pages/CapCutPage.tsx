"use client";

// "CapCut" in the sidebar: the cutting queue. Every draft with raw footage and no finished cut,
// newest footage first; clicking one opens the editor at /edit/<draftId>.
import { useEffect, useState } from "react";
import type { Client } from "@/shared/types";
import type { EditQueueRow } from "@/features/editor/model/queue";

type Props = { clients: Client[]; selectedClientId: number | null };

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = s / 60; if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60; if (h < 24) return `${Math.round(h)} h ago`;
  const d = h / 24; if (d < 7) return `${Math.round(d)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function CapCutPage({ clients, selectedClientId }: Props) {
  const [rows, setRows] = useState<EditQueueRow[] | null>(null);
  const [error, setError] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const selected = clients.find((c) => c.id === selectedClientId) ?? null;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/edit-projects/queue").then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      if (!cancelled) setRows(j.rows);
    }).catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  const shown = (rows || []).filter((r) => !onlySelected || !selected || r.client.id === selected.id);

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-ink">CapCut</h1>
          <p className="text-sm text-faint mt-0.5">Footage that is in and not cut yet. Open one to edit it in the app.</p>
        </div>
        {selected && (
          <button onClick={() => setOnlySelected((v) => !v)}
            className={`o-btn text-xs ${onlySelected ? "o-btn-accent" : "o-btn-ghost"}`}>
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: selected.color }} />
            {onlySelected ? `Only ${selected.name}` : "All clients"}
          </button>
        )}
      </div>

      {error && <div className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">{error}</div>}
      {!rows && !error && <p className="text-sm text-muted">Loading…</p>}
      {rows && shown.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-line-2 py-14 text-center">
          <p className="text-sm font-semibold text-ink-2">Nothing to cut</p>
          <p className="text-xs text-faint mt-1">Drafts appear here once raw clips are uploaded and until a finished video is attached.</p>
        </div>
      )}

      {rows && shown.length > 0 && (
        <ul className="rounded-2xl border border-line bg-surface divide-y divide-line-soft overflow-hidden shadow-soft">
          {shown.map((r) => (
            <li key={r.draftId}>
              <a href={`/edit/${r.draftId}`} className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2 transition-colors">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.client.color }} title={r.client.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink truncate">{r.title}</div>
                  <div className="text-xs text-muted truncate">{r.client.name}</div>
                </div>
                {r.stage ? (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white shrink-0" style={{ backgroundColor: r.stage.color }}>{r.stage.name}</span>
                ) : (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-surface-3 text-muted shrink-0">Ideas</span>
                )}
                <span className="text-xs text-ink-2 w-16 text-right shrink-0">{r.clipCount} clip{r.clipCount === 1 ? "" : "s"}</span>
                <span className="text-xs text-faint w-24 text-right shrink-0" title={new Date(r.footageAt).toLocaleString()}>{ago(r.footageAt)}</span>
                <span className={`text-[10px] font-semibold w-16 text-right shrink-0 ${r.hasProject ? "text-hue-violet-700" : "text-faint"}`}>{r.hasProject ? "In progress" : "New"}</span>
                <span className="text-muted">›</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
