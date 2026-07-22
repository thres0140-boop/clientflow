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
  const { clientId, conceptId, source, sourceTitle, weekLabel, dayLabel, count = 5, format = "auto", keepHook = true, hookAltCount = 3 } = body;
  if (!source || !String(source).trim()) {
    return NextResponse.json({ error: "Paste the winning reel's script first." }, { status: 400 });
  }
  // The proven hook = the first non-empty line of the winning reel.
  const sourceHook = String(source).split("\n").map((l) => l.trim()).find(Boolean) || "";

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

THE TASK — REMIX A PROVEN WINNER (ONE variation at a time):
You are given ONE reel that ALREADY PERFORMED, plus a specific ANGLE to write it in. Keep only its
core MESSAGE — the point, the topic, the promise, the payoff. Then write ONE completely fresh
${isTextOverlay ? "set of on-screen text cards" : "script"} that makes that SAME point in totally new
words, fully committed to the assigned angle. The winner is your BRIEF, not your draft.

HARD RULES:
  • SAME point, BRAND-NEW ${isTextOverlay ? "cards" : "script"} — new sentences, new structure, new
    examples/analogies. It must read as an original.
  • NEVER copy the winner's wording. The winner may be long and detailed; your version is SHORT and
    fresh — a re-transcription (repeating a whole sentence or >5 consecutive words) is a hard failure.
  • ${isTextOverlay ? "4–8 short punchy on-screen lines, one thought per line." : "80–130 words, spoken the way this creator actually talks."}
  • Do NOT drift off the underlying point. Keep this creator's voice, and commit fully to the angle.
${keepHook ? `\nHOOK RULE — KEEP THE PROVEN HOOK:
  • Your "script" is the BODY ONLY — do NOT write the hook anywhere in it (it's re-attached automatically).
  • Set the "hook" field to exactly: "${sourceHook}"` : `\nHOOK RULE — FRESH HOOK:
  • Give it a different opening hook (different first line) that lands the same point.`}
${hookAltCount > 0 ? `\nAlso provide "hookAlternatives": an array of ${hookAltCount} different alternative opening hooks for this one script.` : ""}

Output ONLY one valid JSON object, nothing else:
{ "title": "short title", "hook": "${isTextOverlay ? "first on-screen text line" : "opening hook line"}", "script": "${keepHook ? "the fresh BODY only — no hook" : isTextOverlay ? "on-screen text cards" : "full spoken script"}", "caption": "caption (different angle from the script)"${hookAltCount > 0 ? `, "hookAlternatives": ["alt 1", "alt 2"]` : ""} }`;

  // Distinct angles so each variation is structurally different. Generating ONE variation per
  // API call (each blind to the others, each locked to one angle) is what stops the model from
  // echoing a long detailed winner into every "variation".
  const FRAMES = [
    'a personal STORY / confession — open with "I used to…" and tell a short story',
    "the COMMON MISTAKE people make, then the fix",
    "the HIDDEN MECHANISM — explain WHY this actually happens under the hood",
    "a straight STEP-BY-STEP how-to",
    'a MYTH-BUST / contrarian take — "everyone says X, but the truth is…"',
    "one vivid ANALOGY or metaphor carried all the way through",
    'a direct CHALLENGE to the viewer — "be honest, you…"',
  ];

  async function generateOne(frameIdx: number) {
    const frame = FRAMES[frameIdx % FRAMES.length];
    const userMessage = `PROVEN WINNING reel${sourceTitle ? ` ("${sourceTitle}")` : ""}:
"""
${String(source).trim()}
"""

Write ONE fresh variation that makes the SAME core point as this winner, written completely from scratch using THIS angle: ${frame}.
${isTextOverlay ? "4–8 short on-screen lines." : "80–130 words."} Only the underlying point carries over — do NOT reuse the winner's sentences, order, or structure. Commit hard to the angle so it unmistakably reads as that kind of script.${keepHook ? ` The "script" field is the BODY only (no hook).` : ""}`;
    try {
      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        temperature: 1,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      });
      const raw = message.content[0].type === "text" ? message.content[0].text : "{}";
      const m = raw.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    } catch { return null; }
  }

  const results = await Promise.all(Array.from({ length: count }, (_, i) => generateOne(i)));
  const drafts: { title: string; hook: string; script: string; caption?: string; hookAlternatives?: string[] }[] = results.filter(Boolean);
  if (!drafts.length) {
    return NextResponse.json({ error: "Generation failed — try again." }, { status: 500 });
  }

  const created = [];
  for (const d of drafts) {
    // When keeping the proven hook, the model returns the body only — attach the hook here.
    const finalHook = keepHook ? sourceHook : (d.hook || "");
    let body = (d.script || "").trim();
    if (keepHook && sourceHook && body.startsWith(sourceHook)) {
      body = body.slice(sourceHook.length).replace(/^[\s\-–—:.]+/, "").trim(); // strip any echoed hook
    }
    const finalScript = keepHook && sourceHook ? `${sourceHook}\n\n${body}` : body;
    // Collect all hook options (the active one first), deduped.
    const alts = Array.isArray(d.hookAlternatives) ? d.hookAlternatives.filter((h) => typeof h === "string" && h.trim()) : [];
    const allHooks = Array.from(new Set([finalHook, ...alts].filter(Boolean)));

    const draft = await prisma.scriptDraft.create({
      data: {
        clientId: clientData.id,
        conceptId: concept.id,
        title: d.title || `Remix — ${concept.name}`,
        hook: finalHook || null,
        script: finalScript,
        caption: d.caption || null,
        weekLabel: weekLabel || null,
        dayLabel: dayLabel || null,
        status: "pending",
        isSavedIdea: false,
        isRemix: true,
        hookAlternatives: JSON.stringify(allHooks.length > 1 ? allHooks : []),
      } as any,
      include: {
        concept: { select: { name: true, conceptType: true } },
        client: { select: { name: true, color: true } },
      },
    });
    created.push(draft);
  }

  return NextResponse.json(created, { status: 201 });
}
