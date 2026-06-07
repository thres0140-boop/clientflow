"use client";

import { useRef, useState } from "react";

// Upload a video to Cloudinary (unsigned) with progress, return the secure URL.
function uploadToCloudinary(file: File, onProgress: (pct: number) => void): Promise<string> {
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME!;
  const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!;
  const url = `https://api.cloudinary.com/v1_1/${cloud}/video/upload`;
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", preset);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).secure_url); }
        catch { reject(new Error("Unexpected upload response")); }
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try { const e = JSON.parse(xhr.responseText); if (e?.error?.message) msg = e.error.message; } catch { /* ignore */ }
        const m = msg.match(/Got (\d+)\. Maximum is (\d+)/);
        if (m) msg = `This video is ${Math.round(+m[1] / 1048576)} MB — the upload limit is ${Math.round(+m[2] / 1048576)} MB. Trim or compress it first, then try again.`;
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error(
      `Upload failed (network). This is almost always because the video is too big — ` +
      `it's ${Math.round(file.size / 1048576)} MB and the limit is 100 MB. Compress or trim it and try again.`
    ));
    xhr.send(fd);
  });
}

type Mode = "transcribe" | "onscreen";

export default function TranscribePage() {
  const [mode, setMode] = useState<Mode>("transcribe");
  const [status, setStatus] = useState<"idle" | "uploading" | "reading" | "done" | "error">("idle");
  const [pct, setPct] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(file: File) {
    setError("");
    setTranscript("");
    setCopied(false);
    setFileName(file.name);
    // Cloudinary (free) rejects video over 100 MB — catch it before the upload so the user
    // gets a clear message instead of a confusing mid-upload network error.
    if (file.size > 100 * 1024 * 1024) {
      setError(`This video is ${Math.round(file.size / 1048576)} MB — over the 100 MB limit for transcription. Compress or trim it first (audio-only or 720p export usually does it).`);
      setStatus("error");
      return;
    }
    setStatus("uploading");
    setPct(0);
    try {
      const videoUrl = await uploadToCloudinary(file, setPct);
      setStatus("reading");
      const d = await fetch("/api/import-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, mode }),
      }).then((r) => r.json());
      const text = (d?.text || "").trim();
      if (!text) {
        setError(mode === "transcribe"
          ? "No speech found in this video. If it's a text-on-screen reel, switch to “On-screen text” mode."
          : "No on-screen text found in the first frame.");
        setStatus("error");
        return;
      }
      setTranscript(text);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) run(f);
    e.target.value = "";
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  const busy = status === "uploading" || status === "reading";
  const wordCount = transcript.split(/\s+/).filter(Boolean).length;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900">Transcribe</h1>
      <p className="text-sm text-slate-400 mt-0.5 mb-6">
        Drop any video and get its transcript instantly — no other apps needed.
      </p>

      {/* Mode toggle */}
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 mb-4">
        {([["transcribe", "🎙 Spoken transcript"], ["onscreen", "🔤 On-screen text"]] as [Mode, string][]).map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)} disabled={busy}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors disabled:opacity-50 ${
              mode === m ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-700"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Dropzone */}
      <input ref={fileRef} type="file" accept="video/*" hidden onChange={onPick} />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="w-full border-2 border-dashed border-slate-300 rounded-2xl py-14 flex flex-col items-center justify-center gap-2 hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? (
          <>
            <div className="w-7 h-7 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-semibold text-slate-700">
              {status === "uploading" ? `Uploading… ${pct}%` : "Reading the video…"}
            </span>
            <span className="text-xs text-slate-400 truncate max-w-[80%]">{fileName}</span>
          </>
        ) : (
          <>
            <span className="text-3xl">⬆</span>
            <span className="text-sm font-semibold text-slate-700">Click to choose a video</span>
            <span className="text-xs text-slate-400">
              {mode === "transcribe" ? "We'll pull the spoken words" : "We'll read the on-screen text from the first frame"}
            </span>
          </>
        )}
      </button>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {status === "done" && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Transcript · {wordCount} words
            </span>
            <button onClick={copy}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
              {copied ? "✓ Copied" : "📋 Copy"}
            </button>
          </div>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={14}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button onClick={() => fileRef.current?.click()}
            className="mt-3 text-xs font-semibold text-indigo-600 hover:underline">
            ⬆ Transcribe another video
          </button>
        </div>
      )}
    </div>
  );
}
