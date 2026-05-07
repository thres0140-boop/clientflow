import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clientName, platform, niche, existing } = body;

  const prompt = `You are helping an SMM agency find competitor accounts to track on ${platform || "Instagram"}.

Client: ${clientName}
Their niche/notes: ${niche || "not specified"}
Already tracking: ${existing?.length ? existing.join(", ") : "none"}

Suggest 8 real ${platform || "Instagram"} accounts that are competitors or similar creators in this niche. Return ONLY a JSON array of handles (without @), no explanation. Example: ["handle1", "handle2"]

Focus on accounts that:
- Are in the same niche
- Have a similar audience size or slightly larger
- Post similar content formats
- Are not already in the tracking list`;

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "[]";
    const match = text.match(/\[[\s\S]*\]/);
    const handles = match ? JSON.parse(match[0]) : [];
    return NextResponse.json({ handles });
  } catch {
    return NextResponse.json({ handles: [] }, { status: 500 });
  }
}
