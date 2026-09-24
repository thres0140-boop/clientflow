import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { transcript, conceptName } = await req.json();
  if (!transcript?.trim()) return NextResponse.json({ error: "No transcript provided" }, { status: 400 });

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{
      role: "user",
      content: `You are a social media video strategist. Based on this video transcript, write concise production guidelines (2-4 sentences) covering: pacing/energy, key things to include, delivery style, and what to avoid. Be specific and actionable.

Concept: ${conceptName || ""}
Transcript: ${transcript.slice(0, 3000)}

Write only the guidelines, no intro or labels.`,
    }],
  });

  const guidelines = (msg.content[0] as { text: string }).text.trim();
  return NextResponse.json({ guidelines });
}
