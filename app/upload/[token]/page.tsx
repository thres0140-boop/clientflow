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
}

export default function MobileUploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [draft, setDraft] = useState<DraftInfo | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [done, setDone] = useState(false);


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

  function cloudinaryUpload(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME!;
      const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!;
      const resourceType = file.type.startsWith("video") ? "video" : "image";
      const form = new FormData();
      form.append("file", file);
      form.append("upload_preset", preset);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloud}/${resourceType}/upload`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText).secure_url);
        else reject(new Error(JSON.parse(xhr.responseText).error?.message ?? "Upload failed"));
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(form);
    });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length || !draft) return;
    setUploading(true);
    setProgress(0);
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
      setError(String(err));
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
          <h1 className="text-lg font-bold text-slate-800">Invalid link</h1>
          <p className="text-sm text-slate-500">{error}</p>
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
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center shadow-sm space-y-3">
            <div className="text-5xl">✅</div>
            <h2 className="text-base font-bold text-slate-800">Uploaded!</h2>
            <p className="text-sm text-slate-500">Your video has been sent to the team. You can close this page.</p>
            <label className="text-xs text-indigo-500 underline cursor-pointer">
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
              {uploading ? `Uploading… ${progress}%` : uploaded.length > 0 ? "📎 Upload More Files" : "📱 Select Videos / Photos"}
            </label>

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
