import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DEFAULT_RULES = `1. VOICE IS EVERYTHING
   The #1 mistake is writing scripts that sound "written."
   Every line must sound like the creator talking to a friend.
   If it sounds like a copywriter wrote it → rewrite.

2. DATA OVER OPINION
   Every decision (hook formula, structure, duration, visuals, audio)
   must be backed by the actual performance data from the videos.
   "This hook style averaged 250K views" beats "I think this works."

3. SPECIFICITY WINS
   Vague hooks underperform. Specific trigger words, specific moments,
   specific details — these stop the scroll.

4. CONTRAST = SCROLL STOPPER
   In most niches, the combination of calm delivery/music with hard
   or controversial words creates the pattern interrupt that stops
   people from scrolling. Check if this applies to your creator.

5. THE SYSTEM IS ALIVE
   After the first batch of scripts goes live, track what performs.
   Feed the data back: kill what doesn't work, double down on what does.
   Update the style guide, add new trigger words, remove dead concepts.

6. CAPTION ≠ SCRIPT
   This is the most common mistake. The caption must approach the
   SAME THEME from a COMPLETELY DIFFERENT ANGLE. If the script talks
   about the moment of weakness, the caption talks about the people
   watching you fall. Same theme, different perspective.

7. 2+ PILLARS OR KILL IT
   Single-pillar content is generic. If a script only touches one
   pillar, it's not specific enough to the creator. Merge pillars
   for stronger, more unique content`;

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

    // --- Build system prompt: permanent context about this creator + concept ---
    const blueprintLines = [
      concept.hookType   && `Hook Type: ${concept.hookType}`,
      concept.textHook   && `Text Hook: "${concept.textHook}"`,
      concept.videoType  && `Video Type: ${concept.videoType}`,
      concept.angle      && `Angle: ${concept.angle}`,
      concept.structure  && `Structure: ${concept.structure}`,
      concept.guidelines && `Guidelines:\n${concept.guidelines}`,
    ].filter(Boolean).join("\n");

    const examplesSection = concept.scriptExamples
      ? `\n\nEXAMPLE SCRIPTS — study these, this is the exact voice and style to match:\n` +
        concept.scriptExamples.split(/\n{2,}/).filter(Boolean)
          .map((ex, i) => `Example ${i + 1}:\n${ex.trim()}`).join("\n\n")
      : "";

    const writingRules = concept.scriptRules ?? DEFAULT_RULES;

    const captionStyle = clientData.captionStyle
      ? `\n\nCAPTION STYLE:\n${clientData.captionStyle}`
      : "";

    const systemPrompt = `You are a dedicated script writer for ${clientData.name}, working exclusively on their "${concept.name}" concept. You are in an ongoing collaboration — you remember every script you've written and every piece of feedback you've received.

CONCEPT BLUEPRINT:
${blueprintLines || "No blueprint set yet."}
${examplesSection}

WRITING RULES — follow strictly:
${writingRules}
${captionStyle}

LANGUAGE: ${langInstruction}

Your job: when asked to generate scripts, output ONLY a valid JSON array:
[
  { "title": "short title", "hook": "opening hook line", "script": "full script text", "caption": "caption text (completely different angle from script)" },
  ...
]
Nothing else. No commentary. Just the JSON array.`;

    // --- Load conversation history for this concept ---
    let history: { role: "user" | "assistant"; content: string }[] = [];
    try {
      history = JSON.parse((concept as any).conversationHistory || "[]");
    } catch {
      history = [];
    }

    // --- New user message for this generation ---
    const userMessage = `Generate EXACTLY ${count} completely different script alternatives for ${weekLabel}${dayLabel ? `, ${dayLabel}` : ""}. Each must have a different hook angle. 80–130 words each. Make them feel fresh — don't repeat any hook, angle, or structure pattern you've used before in this conversation.`;

    const messages: { role: "user" | "assistant"; content: string }[] = [
      ...history,
      { role: "user", content: userMessage },
    ];

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
      system: systemPrompt,
      messages,
    });

    const raw = message.content[0].type === "text" ? message.content[0].text : "[]";

    let drafts: { title: string; hook: string; script: string; caption?: string }[] = [];
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      drafts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      drafts = [];
    }

    // --- Append this turn to conversation history ---
    const assistantSummary = drafts.map((d, i) =>
      `Script ${i + 1} — "${d.title}"\nHook: ${d.hook}\nScript: ${d.script}`
    ).join("\n\n---\n\n");

    const updatedHistory = [
      ...history,
      { role: "user" as const, content: userMessage },
      { role: "assistant" as const, content: raw }, // store raw JSON so it's replayable
    ];

    // Keep history from growing too large — keep last 40 turns (20 exchanges)
    const trimmedHistory = updatedHistory.slice(-40);

    await (prisma.concept as any).update({
      where: { id: concept.id },
      data: { conversationHistory: JSON.stringify(trimmedHistory) },
    });

    // --- Save the generated drafts ---
    for (const d of drafts) {
      const draft = await prisma.scriptDraft.create({
        data: {
          clientId: clientData.id,
          conceptId: concept.id,
          title: d.title || `${concept.name} — ${weekLabel}`,
          hook: d.hook || null,
          script: d.script,
          caption: d.caption || null,
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
