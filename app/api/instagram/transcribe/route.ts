import { NextRequest, NextResponse } from "next/server";

// Whisper hallucinates these phrases on silent / music-only audio (common for
// B-roll + text-overlay reels). If the WHOLE transcript is just one of these,
// treat it as empty so the on-screen-text vision path takes over instead.
const HALLUCINATIONS = [
  "thanks for watching",
  "thank you for watching",
  "thank you for watching!",
  "thanks for watching!",
  "thank you so much for watching",
  "thank you.",
  "thank you",
  "please subscribe",
  "don't forget to subscribe",
  "like and subscribe",
  "see you next time",
  "see you in the next video",
  "bye",
  "you",
  "subtitles by the amara.org community",
  "transcription by castingwords",
  "♪",
  "[music]",
  "[music playing]",
  "music",
];

function stripHallucination(text: string): string {
  const t = (text || "").trim();
  if (!t) return "";
  // Normalize: lowercase, strip surrounding punctuation/quotes/emoji/whitespace.
  const norm = t.toLowerCase().replace(/[\s.,!?"'♪♫🎵🎶()[\]-]+/g, " ").trim();
  if (HALLUCINATIONS.some((h) => {
    const hn = h.toLowerCase().replace(/[\s.,!?"'♪♫🎵🎶()[\]-]+/g, " ").trim();
    return norm === hn;
  })) {
    return "";
  }
  return t;
}

// For reels too big for Whisper's 25MB limit: hand the video URL to Cloudinary (unsigned
// upload by remote URL), then pull the audio-only .mp3 derivative — far smaller than the
// video, so length stops mattering. Returns the audio bytes, or null if unavailable.
async function audioViaCloudinary(videoUrl: string): Promise<Buffer | null> {
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  if (!cloud || !preset) return null;
  try {
    const fd = new FormData();
    fd.append("file", videoUrl);
    fd.append("upload_preset", preset);
    const up = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/video/upload`, { method: "POST", body: fd });
    const j = await up.json();
    if (!j?.secure_url) return null;
    const mp3Url = String(j.secure_url).replace(/\.(mp4|mov|webm|m4v|avi)(\?.*)?$/i, ".mp3");
    const ar = await fetch(mp3Url);
    if (!ar.ok) return null;
    const buf = Buffer.from(await ar.arrayBuffer());
    return buf.byteLength > 0 && buf.byteLength <= 24 * 1024 * 1024 ? buf : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { mediaUrl } = await req.json();
  if (!mediaUrl) return NextResponse.json({ error: "mediaUrl required" }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  try {
    // Download the video
    const videoRes = await fetch(mediaUrl);
    if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status}`);

    const videoBuffer = await videoRes.arrayBuffer();
    const sizeMB = videoBuffer.byteLength / (1024 * 1024);
    console.log("Video size:", sizeMB.toFixed(1), "MB");

    // Under Whisper's 25MB limit → send the video directly. Over it (long reels) →
    // extract just the audio via Cloudinary so length no longer matters.
    let fileBuf: Buffer = Buffer.from(videoBuffer);
    let fileName = "reel.mp4";
    let fileType = "video/mp4";
    if (sizeMB > 24) {
      const audio = await audioViaCloudinary(mediaUrl);
      if (!audio) {
        return NextResponse.json({ error: "This reel is too long to transcribe (audio extraction unavailable)." }, { status: 413 });
      }
      fileBuf = audio;
      fileName = "audio.mp3";
      fileType = "audio/mpeg";
    }

    const formData = new FormData();
    formData.append("file", new File([new Uint8Array(fileBuf)], fileName, { type: fileType }));
    formData.append("model", "whisper-1");
    // No language specified = auto-detect (handles Dutch, English, etc.)

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    const result = await whisperRes.json();
    console.log("Whisper result:", JSON.stringify(result).slice(0, 200));

    if (!whisperRes.ok) throw new Error(result.error?.message || "Whisper API error");

    return NextResponse.json({ transcript: stripHallucination(result.text || "") });
  } catch (err) {
    console.error("Transcribe error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
