import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 120;

const HALLUCINATIONS = new Set([
  "thanks for watching", "thank you for watching", "thank you", "please subscribe",
  "like and subscribe", "see you next time", "bye", "you", "music", "[music]", "♪",
]);
function isHallucination(text: string): boolean {
  const norm = (text || "").toLowerCase().replace(/[\s.,!?"'♪♫🎵🎶()[\]-]+/g, " ").trim();
  return HALLUCINATIONS.has(norm);
}

// POST /api/transcribe-audio — multipart form with `file` (an audio chunk, kept small by
// the browser's ffmpeg extraction). Forwards to Whisper, returns { text }.
export async function POST(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  if (!(token && (await verifySessionToken(token)))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ error: "transcription not configured" }, { status: 500 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no audio" }, { status: 400 });

  try {
    const fd = new FormData();
    fd.append("file", file, "audio.mp3");
    fd.append("model", "whisper-1");
    const wr = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd,
    });
    if (!wr.ok) return NextResponse.json({ error: `Whisper ${wr.status}: ${(await wr.text()).slice(0, 200)}` }, { status: 502 });
    const t = ((await wr.json()).text || "").trim();
    return NextResponse.json({ text: isHallucination(t) ? "" : t });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
