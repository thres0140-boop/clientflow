import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { buildExamplesBlock, splitExamples } from "@/lib/conceptExamples";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/script-drafts/remix
// "Remix a winner": take ONE proven reel (its script / on-screen text) and produce N
// variations that say the SAME message a different way — marketing one thing 100 ways.
// Body: { clientId, conceptId, source, sourceTitle?, count, weekLabel, dayLabel }
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "your_key_here") {
    return NextResponse.json({ error: "Add your ANTHROPIC_API_KEY to .env.local" }, { status: 400 });
  }

  const body = await req.json();
  const { clientId, conceptId, source, sourceTitle, weekLabel, dayLabel, count = 5, format = "auto" } = body;
  if (!source || !String(source).trim()) {
    return NextResponse.json({ error: "Paste the winning reel's script first." }, { status: 400 });
  }

  const clientData = await prisma.client.findUnique({ where: { id: parseInt(clientId) } });
  if (!clientData) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const concept = await prisma.concept.findUnique({ where: { id: parseInt(conceptId) } });
  if (!concept) return NextResponse.json({ error: "Concept not found" }, { status: 404 });

  const langInstruction = clientData.language === "nl" ? "Write in Dutch." : `Write in ${clientData.language}.`;

  // Concept voice/blueprint — so the remixes sound like THIS creator making THIS concept.
  const blueprintLines = [
    concept.hookType && `Hook Type: ${concept.hookType}`,
    concept.videoType && `Video Type: ${concept.videoType}`,
    concept.angle && `Angle: ${concept.angle}`,
    concept.structure && `Structure: ${concept.structure}`,
    concept.guidelines && `Guidelines:\n${concept.guidelines}`,
  ].filter(Boolean).join("\n");

  let examplesSection = await buildExamplesBlock(concept);
  if (!examplesSection && concept.scriptExamples) {
    examplesSection = `\n\nVOICE REFERENCE — match this creator's exact voice and style:\n` +
      splitExamples(concept.scriptExamples).map((ex, i) => `Example ${i + 1}:\n${ex.trim()}`).join("\n\n");
  }

  // Format detection — same signals as the generator, so a B-roll/text-hook concept gets
  // tight on-screen cards and a talking-head concept gets a spoken script.
  const vt = (concept.videoType || "").toLowerCase();
  const struct = (concept.structure || "").toLowerCase();
  const guide = (concept.guidelines || "").toLowerCase();
  const textOverlaySignals =
    (concept as any).textOverlay === true ||
    /broll|b-roll|text[\s_-]*overlay|text[\s_-]*hook|on[\s_-]*screen/.test(vt) ||
    /op\s*scherm|tekstkaart|text\s*card|on[\s-]*screen|overlay|regel\s*\d/.test(struct) ||
    /tekstkaart|op\s*scherm|text\s*card|geen\s*voice|no\s*voice|on[\s-]*screen\s*text/.test(guide);
  const isTalkingHead = /talking[\s_-]*head|voiceover|spoken|interview|monolog/.test(vt);
  // Caller can force the format ("text" = on-screen cards, "spoken" = talking-head). Only
  // fall back to auto-detection from the concept when format === "auto".
  const isTextOverlay = format === "text" ? true : format === "spoken" ? false : (textOverlaySignals && !isTalkingHead);

  const captionPlaybook = (clientData as any).captionGuidelines as string | null | undefined;
  const captionStyle = captionPlaybook
    ? `\n\nCAPTION PLAYBOOK — every "caption" MUST follow this exactly (opening style, rhythm, length, emoji rules, and ALWAYS end with the playbook's CTA):\n${captionPlaybook}`
    : clientData.captionStyle ? `\n\nCAPTION STYLE:\n${clientData.captionStyle}` : "";

  const formatInstruction = isTextOverlay
    ? `FORMAT = B-ROLL + ON-SCREEN TEXT (no voiceover). The "script" field is the sequence of on-screen TEXT CARDS — short, punchy, one thought per line, 4–8 lines, ~3–9 words per line. No spoken filler, no stage directions.`
    : `FORMAT = TALKING-HEAD / SPOKEN SCRIPT. The "script" field is the full spoken voiceover — natural, the way the creator actually talks. 80–130 words.`;

  const systemPrompt = `You are a script writer for ${clientData.name}, working on their "${concept.name}" concept.

CONCEPT BLUEPRINT:
${blueprintLines || "No blueprint set."}
${examplesSection}

FORMAT:
${formatInstruction}
${captionStyle}

LANGUAGE: ${langInstruction}

THE TASK — REMIX A PROVEN WINNER:
You are given ONE reel that ALREADY PERFORMED. Your job is NOT to invent new content. It is to
take that exact winning message and re-express it ${count} different ways — same core message,
same emotional payoff, same promise, just different wording / framing / opening each time.
This is "market one thing 100 ways": the message stays identical so the proven result repeats;
only the words change.

HARD RULES:
  • Decode WHY the winner works first (the core claim, the emotional trigger, the turn), then keep
    that DNA in every variation. Do not drift to a new topic, claim, or angle.
  • Each variation must be able to replace the original and still deliver the SAME point.
  • Different hook/opening each time — never reuse the same first line.
  • Keep it in this creator's voice and this concept's format.

Output ONLY a valid JSON array, nothing else:
[
  { "title": "short title", "hook": "${isTextOverlay ? "first on-screen text line" : "opening hook line"}", "script": "${isTextOverlay ? "on-screen text cards (short punchy lines)" : "full spoken script"}", "caption": "caption (different angle from the script)" }
]`;

  const userMessage = `Here is the PROVEN WINNING reel${sourceTitle ? ` ("${sourceTitle}")` : ""} to remix:

"""
${String(source).trim()}
"""

Generate EXACTLY ${count} variations of THIS reel for ${weekLabel || "this batch"}${dayLabel ? `, ${dayLabel}` : ""}. Same message, same payoff — reworded ${count} different ways, each with a fresh hook. Do not change the topic or the point.`;

  let drafts: { title: string; hook: string; script: string; caption?: string }[] = [];
  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 12000,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    const raw = message.content[0].type === "text" ? message.content[0].text : "[]";
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    drafts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch (e) {
    return NextResponse.json({ error: "Generation failed: " + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }

  const created = [];
  for (const d of drafts) {
    const draft = await prisma.scriptDraft.create({
      data: {
        clientId: clientData.id,
        conceptId: concept.id,
        title: d.title || `Remix — ${concept.name}`,
        hook: d.hook || null,
        script: d.script,
        caption: d.caption || null,
        weekLabel: weekLabel || null,
        dayLabel: dayLabel || null,
        status: "pending",
        isSavedIdea: false,
      },
      include: {
        concept: { select: { name: true, conceptType: true } },
        client: { select: { name: true, color: true } },
      },
    });
    created.push(draft);
  }

  return NextResponse.json(created, { status: 201 });
}
