import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { mediaUrl } = await req.json();
  if (!mediaUrl) return NextResponse.json({ error: "mediaUrl required" }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  try {
    // Download the video from Instagram's CDN
    const videoRes = await fetch(mediaUrl);
    if (!videoRes.ok) throw new Error("Failed to fetch video");
    const videoBlob = await videoRes.blob();

    // Send to OpenAI Whisper
    const formData = new FormData();
    formData.append("file", new File([videoBlob], "reel.mp4", { type: "video/mp4" }));
    formData.append("model", "whisper-1");
    formData.append("response_format", "text");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      throw new Error(err);
    }

    const transcript = await whisperRes.text();
    return NextResponse.json({ transcript: transcript.trim() });
  } catch (err) {
    console.error("Transcribe error:", err);
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}
