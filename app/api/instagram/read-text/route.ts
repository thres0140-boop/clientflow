import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/instagram/read-text  { imageUrl }
// Uses Claude vision to read the on-screen text overlay from a reel frame (thumbnail).
// For B-roll + text reels there's no speech, so the "hook" lives in the on-screen text.
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }
  const { imageUrl } = await req.json();
  if (!imageUrl) return NextResponse.json({ error: "imageUrl required" }, { status: 400 });

  try {
    // Fetch the image and pass as base64 (Instagram CDN URLs aren't always URL-fetchable by the API)
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return NextResponse.json({ text: "" });
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const media = (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType) ? contentType : "image/jpeg") as any;

    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: media, data: buf.toString("base64") } },
          { type: "text", text: "This is a frame from an Instagram reel that uses on-screen text overlay. Read and output ONLY the exact on-screen text shown in the image, word for word, preserving line breaks. Do not describe the image, do not add quotes or commentary. If there is no readable text overlay, output nothing." },
        ],
      }],
    });

    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    return NextResponse.json({ text });
  } catch (err) {
    console.error("[read-text] error:", err);
    return NextResponse.json({ text: "", error: String(err) });
  }
}
