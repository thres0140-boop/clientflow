"use client";

// "Add b-roll": pick one of the project's clips (the draft's raw uploads, or anything uploaded
// here before) or upload a new file to R2, then place it on the overlay track at the playhead.
import { useRef, useState } from "react";
import type { EditDocument } from "@/features/editor/model/document";
import { uploadToR2 } from "./upload";
import { fmtTime } from "./Timeline";

type Props = {
  doc: EditDocument;
  onPick: (assetId: string) => void;
  onUploaded: (url: string, name: string) => void;
  onClose: () => void;
};

export default function BrollPicker({ doc, onPick, onUploaded, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(""); setPct(0);
    try {
      const url = await uploadToR2(f, setPct);
      onUploaded(url, f.name);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPct(null); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-[420px] max-w-[92vw] rounded-2xl bg-surface shadow-pop border border-line p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">Add b-roll at the playhead</h3>
          <button onClick={onClose} className="text-muted hover:text-ink text-sm">✕</button>
        </div>
        <ul className="max-h-64 overflow-y-auto divide-y divide-line-soft rounded-lg border border-line-soft">
          {doc.assets.map((a) => (
            <li key={a.id}>
              <button onClick={() => onPick(a.id)} disabled={a.durationMs == null} className="w-full text-left px-3 py-2 hover:bg-surface-2 disabled:opacity-50 flex items-center justify-between gap-3">
                <span className="text-xs text-ink truncate">{a.name}</span>
                <span className="text-[10px] font-mono text-faint shrink-0">{a.durationMs != null ? fmtTime(a.durationMs) : "loading…"}</span>
              </button>
            </li>
          ))}
          {doc.assets.length === 0 && <li className="px-3 py-3 text-xs text-faint">No clips yet.</li>}
        </ul>
        <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />
        {error && <p className="text-xs text-danger-600 bg-danger-50 px-3 py-2 rounded-lg">{error}</p>}
        <button onClick={() => fileRef.current?.click()} disabled={pct !== null} className="o-btn o-btn-ghost w-full text-xs">
          {pct !== null ? `Uploading ${pct}%` : "⬆ Upload a new file"}
        </button>
      </div>
    </div>
  );
}
