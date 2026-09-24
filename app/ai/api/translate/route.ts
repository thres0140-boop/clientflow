import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/translate  { text, target? }  → { text }
// Translates a short-form video script into natural, spoken language (default Dutch).
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "AI not configured" }, { status: 500 });
  const { text, target } = await req.json();
  const src = String(text || "").trim();
  if (!src) return NextResponse.json({ error: "no text" }, { status: 400 });
  const lang = (target || "Dutch").toString();
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: `Translate this short-form video script into natural, casual, spoken ${lang} as a social-media creator would actually say it (not a literal/formal translation). Keep it punchy. Output ONLY the translation, no preamble.\n\n---\n${src}`,
      }],
    });
    const out = msg.content.filter((b: { type: string }) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    return NextResponse.json({ text: out });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
