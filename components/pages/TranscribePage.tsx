"use client";

import { useRef, useState } from "react";
import type { FFmpeg } from "@ffmpeg/ffmpeg";

const FFMPEG_VER = "0.12.15";
const CORE_VER = "0.12.10";

type Mode = "transcribe" | "onscreen";
type Status = "idle" | "loading" | "extracting" | "working" | "done" | "error";

export default function TranscribePage() {
  const [mode, setMode] = useState<Mode>("transcribe");
  const [status, setStatus] = useState<Status>("idle");
  const [pct, setPct] = useState(0);
  const [note, setNote] = useState("");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);

  // Load ffmpeg.wasm once. Single-threaded core (no cross-origin isolation needed).
  async function getFfmpeg(): Promise<FFmpeg> {
    if (ffmpegRef.current) return ffmpegRef.current;
    setStatus("loading");
    setNote("Loading the audio engine (first time only)…");
    const { FFmpeg } = await import("@ffmpeg/ffmpeg");
    const { toBlobURL } = await import("@ffmpeg/util");
    const ff = new FFmpeg();
    ff.on("progress", ({ progress }: { progress: number }) => {
      const p = Math.max(0, Math.min(100, Math.round(progress * 100)));
      if (!isNaN(p)) setPct(p);
    });
    // ffmpeg creates a MODULE worker, so we must use the ESM worker (uses dynamic import())
    // and the ESM core — not the UMD ones (which use importScripts, invalid in a module worker).
    const core = `https://unpkg.com/@ffmpeg/core@${CORE_VER}/dist/esm`;
    await ff.load({
      classWorkerURL: await toBlobURL(`https://unpkg.com/@ffmpeg/ffmpeg@${FFMPEG_VER}/dist/esm/worker.js`, "text/javascript"),
      coreURL: await toBlobURL(`${core}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${core}/ffmpeg-core.wasm`, "application/wasm"),
    });
    ffmpegRef.current = ff;
    return ff;
  }

  async function run(file: File) {
    setError("");
    setTranscript("");
    setCopied(false);
    setFileName(file.name);
    setPct(0);
    try {
      const ff = await getFfmpeg();
      const { fetchFile } = await import("@ffmpeg/util");
      const ext = (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const inName = `input.${ext}`;
      await ff.writeFile(inName, await fetchFile(file));

      if (mode === "onscreen") {
        setStatus("extracting");
        setNote("Grabbing a frame…");
        await ff.exec(["-i", inName, "-frames:v", "1", "-vf", "scale='min(900,iw)':-2", "frame.jpg"]);
        const img = await ff.readFile("frame.jpg");
        const blob = new Blob([img as BlobPart], { type: "image/jpeg" });
        setStatus("working");
        setNote("Reading on-screen text…");
        const fd = new FormData();
        fd.append("file", blob, "frame.jpg");
        const d = await fetch("/api/vision-ocr", { method: "POST", body: fd }).then((r) => r.json());
        await ff.deleteFile(inName).catch(() => {});
        await ff.deleteFile("frame.jpg").catch(() => {});
        const text = (d?.text || "").trim();
        if (!text) { setError(d?.error || "No on-screen text found in the first frame."); setStatus("error"); return; }
        setTranscript(text);
        setStatus("done");
        return;
      }

      // transcribe: extract low-bitrate mono audio, split into ~10-min segments so each
      // chunk stays well under the server's request limit, transcribe each, join.
      setStatus("extracting");
      setNote("Extracting audio…");
      await ff.exec([
        "-i", inName, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
        "-f", "segment", "-segment_time", "600", "seg%03d.mp3",
      ]);
      const entries = await ff.listDir("/");
      const segs = entries
        .filter((e: { name: string; isDir: boolean }) => !e.isDir && /^seg\d+\.mp3$/.test(e.name))
        .map((e: { name: string }) => e.name)
        .sort();
      if (segs.length === 0) { setError("Couldn't extract audio from this file."); setStatus("error"); return; }

      setStatus("working");
      const parts: string[] = [];
      for (let i = 0; i < segs.length; i++) {
        setNote(segs.length > 1 ? `Transcribing part ${i + 1} of ${segs.length}…` : "Transcribing…");
        setPct(Math.round((i / segs.length) * 100));
        const data = await ff.readFile(segs[i]);
        const blob = new Blob([data as BlobPart], { type: "audio/mpeg" });
        const fd = new FormData();
        fd.append("file", blob, "audio.mp3");
        const d = await fetch("/api/transcribe-audio", { method: "POST", body: fd }).then((r) => r.json());
        if (d?.error) { setError(d.error); setStatus("error"); return; }
        if (d?.text) parts.push(d.text);
        await ff.deleteFile(segs[i]).catch(() => {});
      }
      await ff.deleteFile(inName).catch(() => {});
      const text = parts.join(" ").trim();
      if (!text) {
        setError("No speech found. If it's a text-on-screen reel, switch to “On-screen text” mode.");
        setStatus("error");
        return;
      }
      setTranscript(text);
      setStatus("done");
    } catch (e) {
      setError("Failed: " + (e instanceof Error ? e.message : String(e)));
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

  const busy = status === "loading" || status === "extracting" || status === "working";
  const wordCount = transcript.split(/\s+/).filter(Boolean).length;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900">Transcribe</h1>
      <p className="text-sm text-slate-400 mt-0.5 mb-6">
        Drop any video — any size — and get its transcript instantly. The audio is pulled out in your browser, so there's no upload limit.
      </p>

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

      <input ref={fileRef} type="file" accept="video/*" hidden onChange={onPick} />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="w-full border-2 border-dashed border-slate-300 rounded-2xl py-14 flex flex-col items-center justify-center gap-2 hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? (
          <>
            <div className="w-7 h-7 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-semibold text-slate-700">{note || "Working…"}{pct > 0 && status !== "loading" ? ` ${pct}%` : ""}</span>
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
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Transcript · {wordCount} words</span>
            <button onClick={copy} className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700">
              {copied ? "✓ Copied" : "📋 Copy"}
            </button>
          </div>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={14}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button onClick={() => fileRef.current?.click()} className="mt-3 text-xs font-semibold text-indigo-600 hover:underline">
            ⬆ Transcribe another video
          </button>
        </div>
      )}
    </div>
  );
}
