"use client";

import { useEffect, useState } from "react";
import { use } from "react";

interface Draft {
  id: number;
  title: string;
  hook: string | null;
  script: string;
  caption: string | null;
  clientName: string;
  clientColor: string;
  conceptName: string | null;
  editedVideoUrl: string | null;
  stageName: string | null;
  nextStageName: string | null;
}

// Phone-friendly review page (no login). Shows the finished video + script, and lets the
// reviewer push it to the next stage or send it back with a note — straight from the link.
export default function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [showSendBack, setShowSendBack] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    fetch(`/api/upload-tokens/${token}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setDraft(d); })
      .catch(() => setError("Couldn't load this review link."));
  }, [token]);

  async function advance() {
    setBusy(true);
    try {
      const d = await fetch(`/api/upload-tokens/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "advance" }) }).then((r) => r.json());
      setDoneMsg(d.done ? "✓ Approved — it's at the final stage." : `✓ Approved — moved to ${d.nextStage}.`);
    } catch { setError("Something went wrong — try again."); }
    finally { setBusy(false); }
  }

  async function sendBack() {
    setBusy(true);
    try {
      const d = await fetch(`/api/upload-tokens/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sendback", note }) }).then((r) => r.json());
      setDoneMsg(`↩ Sent back to ${d.sentBackTo} with your note.`);
    } catch { setError("Something went wrong — try again."); }
    finally { setBusy(false); setShowSendBack(false); }
  }

  if (error) {
    return <div style={wrap}><div style={{ textAlign: "center", color: "#64748b" }}><div style={{ fontSize: 40 }}>🔗</div><p style={{ fontWeight: 700, color: "#0f1c34" }}>Invalid link</p><p style={{ fontSize: 14 }}>{error}</p></div></div>;
  }
  if (!draft) {
    return <div style={wrap}><div style={{ width: 28, height: 28, border: "3px solid #c7d2fe", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 1s linear infinite" }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;
  }
  if (doneMsg) {
    return <div style={wrap}><div style={{ textAlign: "center", maxWidth: 420, padding: 24 }}><div style={{ fontSize: 44, marginBottom: 8 }}>✅</div><h1 style={{ fontSize: 20, color: "#0f1c34", margin: "0 0 6px" }}>{doneMsg}</h1><p style={{ color: "#64748b", fontSize: 14 }}>You can close this page.</p></div></div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: "20px 16px 40px", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: draft.clientColor || "#6366f1", textTransform: "uppercase", letterSpacing: ".04em", margin: 0 }}>
          {draft.clientName}{draft.conceptName ? ` · ${draft.conceptName}` : ""}
        </p>
        <h1 style={{ fontSize: 20, color: "#0f1c34", margin: "4px 0 2px" }}>{draft.title}</h1>
        {draft.stageName && <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 14px" }}>Stage: {draft.stageName}</p>}

        {draft.editedVideoUrl ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={draft.editedVideoUrl} controls playsInline style={{ width: "100%", borderRadius: 14, background: "#000", maxHeight: "62vh" }} />
        ) : (
          <div style={{ padding: 24, background: "#fff", borderRadius: 14, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>No finished video uploaded yet.</div>
        )}

        {draft.caption && (
          <div style={{ marginTop: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".04em", margin: "0 0 4px" }}>Caption</p>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 12px", fontSize: 13, color: "#334155", whiteSpace: "pre-wrap" }}>{draft.caption}</div>
          </div>
        )}

        {!showSendBack ? (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
            <button onClick={advance} disabled={busy}
              style={{ ...btn, background: "#16a34a", color: "#fff" }}>
              {busy ? "…" : draft.nextStageName ? `✓ Approve → ${draft.nextStageName}` : "✓ Approve (final stage)"}
            </button>
            <button onClick={() => setShowSendBack(true)} disabled={busy}
              style={{ ...btn, background: "#fff", color: "#b45309", border: "1px solid #fcd34d" }}>
              ↩ Send back with a note
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 20 }}>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} autoFocus
              placeholder="What needs to change?"
              style={{ width: "100%", boxSizing: "border-box", border: "1px solid #fcd34d", borderRadius: 12, padding: 12, fontSize: 14, fontFamily: "inherit" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => setShowSendBack(false)} style={{ ...btn, flex: 1, background: "#f1f5f9", color: "#475569" }}>Cancel</button>
              <button onClick={sendBack} disabled={busy || !note.trim()} style={{ ...btn, flex: 2, background: "#f59e0b", color: "#fff", opacity: !note.trim() ? 0.5 : 1 }}>{busy ? "…" : "↩ Send back"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" };
const btn: React.CSSProperties = { padding: "13px 16px", borderRadius: 12, border: "none", fontSize: 15, fontWeight: 700, cursor: "pointer" };
