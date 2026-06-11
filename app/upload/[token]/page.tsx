"use client";

import { useEffect, useState } from "react";
import { use } from "react";

interface DraftInfo {
  id: number;
  title: string;
  hook: string | null;
  script: string;
  clientName: string;
  clientColor: string;
  conceptName: string | null;
  rawContentUrls: string;
  stageName?: string | null;
  nextStageName?: string | null;
}

export default function MobileUploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [draft, setDraft] = useState<DraftInfo | null>(null);
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [advancedTo, setAdvancedTo] = useState<string | null>(null);

  async function advanceStage() {
    setAdvancing(true);
    try {
      const d = await fetch(`/api/upload-tokens/${token}`, { method: "POST" }).then((r) => r.json());
      if (d.nextStage) setAdvancedTo(d.nextStage);
      else if (d.done) setAdvancedTo("__done__");
    } catch { /* ignore */ }
    finally { setAdvancing(false); }
  }


  useEffect(() => {
    fetch(`/api/upload-tokens/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setDraft(d);
        setUploaded(JSON.parse(d.rawContentUrls || "[]"));
      })
      .catch(() => setError("Could not load upload page."));
  }, [token]);

  function cloudinaryAttempt(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME!;
      const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!;
      const resourceType = file.type.startsWith("video") ? "video" : "image";
      const form = new FormData();
      form.append("file", file);
      form.append("upload_preset", preset);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloud}/${resourceType}/upload`);
      xhr.timeout = 10 * 60_000;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText).secure_url);
        else { try { reject(new Error(JSON.parse(xhr.responseText).error?.message ?? `Upload failed (${xhr.status})`)); } catch { reject(new Error(`Upload failed (${xhr.status})`)); } }
      };
      xhr.onerror = () => reject(new Error("network"));
      xhr.ontimeout = () => reject(new Error("timeout"));
      xhr.send(form);
    });
  }

  // Retry transient network blips a few times before giving up (phones drop connections).
  async function cloudinaryUpload(file: File): Promise<string> {
    let lastErr: unknown;
    for (let i = 1; i <= 3; i++) {
      try { return await cloudinaryAttempt(file); }
      catch (e) { lastErr = e; const m = e instanceof Error ? e.message : String(e); if (i < 3 && (m === "network" || m === "timeout")) { setProgress(0); await new Promise((r) => setTimeout(r, 1200 * i)); } else throw e; }
    }
    throw lastErr;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length || !draft) return;
    setUploading(true);
    setProgress(0);
    setUploadError("");
    try {
      for (let i = 0; i < files.length; i++) {
        const url = await cloudinaryUpload(files[i]);
        await fetch(`/api/upload-tokens/${token}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        setUploaded((prev) => [...prev, url]);
        // Reset progress between files
        if (i < files.length - 1) setProgress(0);
      }
      setDone(true);
    } catch (err) {
      // Show upload problems INLINE — never replace the page with the scary "Invalid link"
      // screen (the link is fine; the upload just hiccuped).
      const m = err instanceof Error ? err.message : String(err);
      setUploadError(
        m === "network" || m === "timeout"
          ? "Upload interrupted (weak connection). Your other files are saved — tap to try this one again."
          : `Upload failed: ${m}`
      );
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="text-5xl">🔗</div>
          <h1 className="text-lg font-bold text-slate-800">{/expired|invalid/i.test(error) ? "Invalid link" : "Couldn't load"}</h1>
          <p className="text-sm text-slate-500">{error}</p>
          <button onClick={() => location.reload()} className="mt-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">Reload</button>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-5 py-4 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
          style={{ backgroundColor: draft.clientColor }}
        >
          {draft.clientName[0]}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-slate-400 truncate">{draft.clientName}</p>
          <p className="text-sm font-bold text-slate-800 truncate">{draft.title}</p>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Script preview */}
        {draft.hook && (
          <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Hook</p>
            <p className="text-sm text-slate-700 font-medium">{draft.hook}</p>
          </div>
        )}
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Script</p>
          <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{draft.script}</p>
        </div>

        {/* Already uploaded */}
        {uploaded.length > 0 && (
          <div className="bg-green-50 border border-green-100 rounded-2xl p-4">
            <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide mb-2">
              {uploaded.length} file{uploaded.length > 1 ? "s" : ""} uploaded
            </p>
            <div className="space-y-1">
              {uploaded.map((u, i) => (
                <p key={i} className="text-xs text-green-700 truncate">✓ File {i + 1}</p>
              ))}
            </div>
          </div>
        )}

        {/* Upload area */}
        {done ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center shadow-sm space-y-4">
            <div className="text-5xl">✅</div>
            <h2 className="text-base font-bold text-slate-800">Uploaded!</h2>
            <p className="text-sm text-slate-500">Your video has been sent to the team.</p>

            {/* Push it straight to the next stage from the phone */}
            {advancedTo ? (
              <div className="w-full py-3 rounded-2xl text-sm font-bold bg-green-50 border border-green-100 text-green-700">
                ✓ {advancedTo === "__done__" ? "Marked done" : `Sent to ${advancedTo}`} — you can close this page.
              </div>
            ) : draft.nextStageName ? (
              <button onClick={advanceStage} disabled={advancing}
                className="block w-full py-4 rounded-2xl text-white text-base font-bold shadow-lg disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
                {advancing ? "Sending…" : `➡️ Done — send to ${draft.nextStageName}`}
              </button>
            ) : null}

            <label className="block text-xs text-indigo-500 underline cursor-pointer">
              <input type="file" accept="video/*,image/*" multiple className="hidden"
                onChange={(e) => { setDone(false); handleFile(e); }} />
              Upload another file
            </label>
          </div>
        ) : (
          <div className="space-y-3">
            <label className={`block w-full py-4 rounded-2xl text-white text-base font-bold shadow-lg text-center transition-opacity ${uploading ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}
              style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}>
              <input
                type="file"
                accept="video/*,image/*"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={handleFile}
              />
              {uploading ? `Uploading… ${progress}%` : uploadError ? "🔁 Try again" : uploaded.length > 0 ? "📎 Upload More Files" : "📱 Select Videos / Photos"}
            </label>

            {uploadError && !uploading && (
              <p className="text-center text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{uploadError}</p>
            )}

            {uploading && (
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <div
                  className="h-2 bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            <p className="text-center text-xs text-slate-400">
              You can select multiple videos or photos at once
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
