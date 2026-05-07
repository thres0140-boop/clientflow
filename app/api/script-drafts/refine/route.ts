import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { originalScript, hook, messages, language = "nl" } = body;

  const langNote = language === "nl" ? "Keep the script in Dutch." : `Keep the script in ${language}.`;

  const systemPrompt = `You are helping refine a social media video script.
Original script:
---
${hook ? `Hook: ${hook}\n\n` : ""}${originalScript}
---
When asked to make changes, output ONLY the revised script — no preamble, no explanation, no labels. Keep it 80–130 words. ${langNote}`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: systemPrompt,
    messages: messages.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });

  const script = response.content[0].type === "text" ? response.content[0].text.trim() : "";
  return NextResponse.json({ script });
}
