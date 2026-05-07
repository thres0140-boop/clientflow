import { NextRequest, NextResponse } from "next/server";

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

    // Whisper limit is 25MB
    if (sizeMB > 24) {
      return NextResponse.json({ error: "Video too large for transcription (max 25MB)" }, { status: 413 });
    }

    const formData = new FormData();
    formData.append("file", new File([videoBuffer], "reel.mp4", { type: "video/mp4" }));
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

    return NextResponse.json({ transcript: result.text?.trim() || "" });
  } catch (err) {
    console.error("Transcribe error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
