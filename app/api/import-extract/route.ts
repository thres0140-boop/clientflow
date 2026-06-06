import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HALLUCINATIONS = new Set([
  "thanks for watching", "thank you for watching", "thank you", "please subscribe",
  "like and subscribe", "see you next time", "bye", "you", "music", "[music]", "♪",
]);
function isHallucination(text: string): boolean {
  const norm = (text || "").toLowerCase().replace(/[\s.,!?"'♪♫🎵🎶()[\]-]+/g, " ").trim();
  return HALLUCINATIONS.has(norm);
}

// Turn a Cloudinary video URL into a first-frame JPG URL (so_0 = offset 0s).
function cloudinaryFrame(url: string): string | null {
  if (!/res\.cloudinary\.com\/.+\/video\/upload\//.test(url)) return null;
  return url.replace("/video/upload/", "/video/upload/so_0/").replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, ".jpg");
}

// Cloudinary can deliver just the audio track of a video by swapping the extension
// to .mp3 — far smaller than the video, so it stays under Whisper's 24 MB limit.
function cloudinaryAudio(url: string): string | null {
  if (!/res\.cloudinary\.com\/.+\/video\/upload\//.test(url)) return null;
  return url.replace(/\.(mp4|mov|webm|m4v|avi)(\?.*)?$/i, ".mp3");
}

async function transcribe(videoUrl: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return "";
  // Prefer the audio-only version (small); fall back to the raw video.
  const candidates = [cloudinaryAudio(videoUrl), videoUrl].filter(Boolean) as string[];
  for (const src of candidates) {
    try {
      const vr = await fetch(src);
      if (!vr.ok) continue;
      const buf = await vr.arrayBuffer();
      if (buf.byteLength / (1024 * 1024) > 24) continue; // Whisper hard limit — try next
      const isAudio = src.endsWith(".mp3");
      const fd = new FormData();
      fd.append("file", new File([buf], isAudio ? "audio.mp3" : "video.mp4", { type: isAudio ? "audio/mpeg" : "video/mp4" }));
      fd.append("model", "whisper-1");
      const wr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd,
      });
      if (!wr.ok) continue;
      const t = ((await wr.json()).text || "").trim();
      if (t && !isHallucination(t)) return t;
    } catch { /* try next candidate */ }
  }
  return "";
}

async function readOnScreen(videoUrl: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) return "";
  const frame = cloudinaryFrame(videoUrl);
  if (!frame) return "";
  try {
    const imgRes = await fetch(frame);
    if (!imgRes.ok) return "";
    const data = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
          { type: "text", text: "This is a frame from an Instagram reel that uses on-screen text overlay. Output ONLY the exact on-screen text shown, word for word, preserving line breaks. No commentary. If there's no readable text, output nothing." },
        ],
      }],
    });
    return msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  } catch { return ""; }
}

// POST /api/import-extract  { videoUrl, mode: "transcribe" | "onscreen" }
export async function POST(req: NextRequest) {
  const { videoUrl, mode } = await req.json();
  if (!videoUrl) return NextResponse.json({ text: "" });
  const text = mode === "onscreen" ? await readOnScreen(videoUrl) : await transcribe(videoUrl);
  return NextResponse.json({ text });
}
