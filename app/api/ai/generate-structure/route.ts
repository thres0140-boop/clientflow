import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const { transcript, conceptName } = await req.json();
  if (!transcript?.trim()) return NextResponse.json({ error: "No transcript provided" }, { status: 400 });

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 150,
    messages: [{
      role: "user",
      content: `You are a social media video strategist. Based on this video transcript, write a concise video structure breakdown using this format: "Section (Xs) → Section (Xs) → ...". Include 3-6 sections with approximate seconds for each. Be specific to what this video actually does.

Concept: ${conceptName || ""}
Transcript: ${transcript.slice(0, 3000)}

Write only the structure line, no intro or labels. Example format: "Hook (3s) → Problem setup (8s) → Solution reveal (12s) → Proof (7s) → CTA (5s)"`,
    }],
  });

  const structure = (msg.content[0] as { text: string }).text.trim();
  return NextResponse.json({ structure });
}
