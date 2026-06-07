import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/vision-ocr — multipart form with `file` (a JPG frame). Returns the on-screen
// text read by Claude vision as { text }.
export async function POST(req: NextRequest) {
  const token = req.cookies.get("cf_session")?.value;
  if (!(token && (await verifySessionToken(token)))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "vision not configured" }, { status: 500 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no image" }, { status: 400 });

  try {
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
          { type: "text", text: "This is a frame from a short-form video that uses on-screen text overlay. Output ONLY the exact on-screen text shown, word for word, preserving line breaks. No commentary. If there's no readable text, output nothing." },
        ],
      }],
    });
    const text = msg.content.filter((b: { type: string }) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
