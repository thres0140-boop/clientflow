import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your_key_here") {
    return NextResponse.json({ error: "Add your ANTHROPIC_API_KEY to .env.local" }, { status: 400 });
  }

  const body = await req.json();
  const { clientId, conceptIds, weekLabel, dayLabel, count = 5 } = body;

  const clientData = await prisma.client.findUnique({ where: { id: parseInt(clientId) } });
  if (!clientData) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const concepts = await prisma.concept.findMany({
    where: { id: { in: conceptIds.map(Number) } },
  });

  const langInstruction = clientData.language === "nl"
    ? "Write in Dutch."
    : `Write in ${clientData.language}.`;

  const created = [];

  for (const concept of concepts) {
    const prompt = `
You are writing ${count} alternative scripts for a social media video.

Client: ${clientData.name}
Concept: ${concept.name}
Hook Type: ${concept.hookType || "Not specified"}
Text Hook: ${concept.textHook || "Not specified"}
Angle: ${concept.angle || "Not specified"}
Structure: ${concept.structure || "Not specified"}
Guidelines: ${concept.guidelines || "Not specified"}
Week: ${weekLabel}${dayLabel ? `, ${dayLabel}` : ""}

Generate EXACTLY ${count} completely different script alternatives. Each should have a different hook angle but follow the same concept framework. 80–130 words each. ${langInstruction}

Output as JSON array:
[
  { "title": "short title", "hook": "opening hook line", "script": "full script text" },
  ...
]
Only output the JSON array, nothing else.
    `.trim();

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
      system: "You are an expert social media script writer. Output only valid JSON as instructed.",
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "[]";

    let drafts: { title: string; hook: string; script: string }[] = [];
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      drafts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      drafts = [];
    }

    for (const d of drafts) {
      const draft = await prisma.scriptDraft.create({
        data: {
          clientId: clientData.id,
          conceptId: concept.id,
          title: d.title || `${concept.name} — ${weekLabel}`,
          hook: d.hook || null,
          script: d.script,
          weekLabel,
          dayLabel: dayLabel || null,
          status: "pending",
          isSavedIdea: false,
        },
        include: {
          concept: { select: { name: true } },
          client: { select: { name: true, color: true } },
        },
      });
      created.push(draft);
    }
  }

  return NextResponse.json(created, { status: 201 });
}
