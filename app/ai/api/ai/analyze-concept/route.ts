import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/ai/analyze-concept
// Body: { scriptExamples, conceptName?, caption?, textOverlay? }
// Analyzes the reel's script (spoken transcript OR on-screen text) and fills out
// the whole concept blueprint in one shot — including detecting the FORMAT
// (talking-head spoken vs B-roll + text-hook overlay).
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your_key_here") {
    return NextResponse.json({ error: "Add your ANTHROPIC_API_KEY" }, { status: 400 });
  }

  const { scriptExamples, conceptName, caption, textOverlay } = await req.json();
  const source = (scriptExamples || "").trim();
  if (!source && !caption) {
    return NextResponse.json({ error: "Nothing to analyze — add a script example or caption first." }, { status: 400 });
  }

  const hintLine = textOverlay
    ? `HINT: This reel was flagged as B-roll + on-screen text overlay (no voiceover). The text below is the ON-SCREEN TEXT, not a spoken script.`
    : `Decide the format yourself from the content below.`;

  const prompt = `You are a short-form video strategist. Analyze this Instagram reel and reverse-engineer its content blueprint so it can be reused as a repeatable concept.

${hintLine}

Concept name: ${conceptName || "(none)"}
${caption ? `Caption: ${caption.slice(0, 800)}\n` : ""}Script / on-screen text:
"""
${source.slice(0, 3000)}
"""

First, classify the FORMAT:
- "talking" = a person speaking to camera (talking-head, spoken voiceover/monologue).
- "text_overlay" = B-roll / footage with short punchy on-screen TEXT and no real spoken script (viral text-hook style, often just music).

Then fill out the blueprint. Output ONLY a valid JSON object, nothing else:
{
  "isTextOverlay": true | false,
  "videoType": "talking_head" | "broll" | "voiceover" | "montage" | "tutorial" | "interview" | "screen_record",
  "hookType": "one of: question, statement, statistic, story, controversy, curiosity_gap, challenge",
  "textHook": "a reusable TEMPLATE of the opening hook with [brackets] for the swappable parts, e.g. \\"On a day you [realisation]...\\"",
  "audioHook": "describe the audio: trending sound / voiceover tone / silent-with-music / etc (short)",
  "angle": "the core angle or emotional driver in a few words",
  "structure": "Section (Xs) → Section (Xs) → ... (3-6 sections with approx seconds, specific to THIS reel)",
  "guidelines": "2-4 sentences of production guidance: pacing/energy, delivery style, what to include, what to avoid. If text_overlay, focus on on-screen text rhythm, line length, and footage choice."
}
Write the textHook, angle and guidelines in the SAME LANGUAGE as the reel's content. No commentary, just the JSON.`;

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content[0].type === "text" ? msg.content[0].text : "{}";
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[analyze-concept] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
