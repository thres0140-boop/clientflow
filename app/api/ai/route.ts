import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { concept, language = "nl", clientName } = body;

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your_key_here") {
    return NextResponse.json({ error: "Add your ANTHROPIC_API_KEY to .env.local" }, { status: 400 });
  }

  const langInstruction = language === "nl"
    ? "Write the script in Dutch."
    : `Write the script in ${language}.`;

  const prompt = `
Client: ${clientName || "Unknown"}
Concept Name: ${concept.name}
Hook Type: ${concept.hookType || "Not specified"}
Text Hook Template: ${concept.textHook || "Not specified"}
Audio Hook: ${concept.audioHook || "Not specified"}
Video Type: ${concept.videoType || "Not specified"}
Angle: ${concept.angle || "Not specified"}
Structure: ${concept.structure || "Not specified"}
Guidelines: ${concept.guidelines || "Not specified"}

Generate a complete, engaging video script following these guidelines exactly. Format it clearly with the hook, main content sections, and CTA. Keep it tight and punchy. 80–130 words max. ${langInstruction}
  `.trim();

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
    system: "You are an expert social media script writer who creates viral short-form video scripts. Follow the exact guidelines provided. Output only the script itself — no preamble, no explanation.",
  });

  const script = message.content[0].type === "text" ? message.content[0].text : "";
  return NextResponse.json({ script });
}
